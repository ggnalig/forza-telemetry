export interface ShiftOutcome {
  rpm: number;
  score: number;
  timestamp: number;
}

export interface ShiftHistory {
  [gear: number]: ShiftOutcome[];
}

export interface HybridShiftData {
  finalShiftRPM: number;
  shiftWindow: [number, number];
  recommendation: "upshift" | "downshift" | "hold";
  lights?: string[];
}

export interface ShiftEngineInput {
  gear: number;
  rpm: number;
  speed: number;
  maxRpm: number;
  idleRpm: number;
  /** Power-curve-derived optimal RPM for this gear, from GearEfficiencyMapGenerator. */
  rpmOptimal: number;
  /** WOT sample count backing rpmOptimal - used as the confidence weight. */
  sampleCount: number;
  throttle: number;
  /** (nextGearRatio / currentGearRatio) from GearRatioEstimator, or null if unknown. */
  ratioToNextGear: number | null;
  /** (previousGearRatio / currentGearRatio) from GearRatioEstimator, or null if unknown. */
  ratioToPreviousGear: number | null;
  /** Pooled WOT power-vs-rpm lookup, from EnginePowerCurve. */
  lookupPower: (rpm: number) => number | null;
  /** Sample count backing lookupPower - gates whether the crossover method can be trusted yet. */
  powerCurveSampleCount: number;
}

// Gear byte in Forza telemetry: 0 = neutral, 1-10 = forward gears.
export const MAX_SUPPORTED_GEAR = 10;

export class ShiftEngine {
  private shiftHistory: ShiftHistory = {};
  private lastGear: number = 0;
  private lastRPM: number = 0;
  private lastThrottle: number = 0;
  private shiftLightBuffer: string[] = [];
  private blinkState: boolean = false;
  private blinkCounter: number = 0;
  private readonly MAX_BUFFER_SIZE = 10;
  private readonly MAX_HISTORY = 50;
  private readonly WINDOW_MARGIN_RATIO = 0.08;
  private readonly WOT_THROTTLE_THRESHOLD = 0.9;
  private readonly MIN_CONFIDENT_SAMPLES = 5;
  private readonly MIN_POWER_CURVE_SAMPLES = 20;
  private readonly BOOTSTRAP_REDLINE_RATIO = 0.92;
  private readonly REDLINE_SAFETY_MARGIN_RATIO = 0.98;
  private readonly IDLE_SAFETY_MARGIN_RPM = 300;

  update(input: ShiftEngineInput): HybridShiftData {
    const {
      gear,
      rpm,
      speed,
      maxRpm,
      idleRpm,
      rpmOptimal,
      sampleCount,
      throttle,
      ratioToNextGear,
      ratioToPreviousGear,
      lookupPower,
      powerCurveSampleCount,
    } = input;

    if (gear < 1 || gear > MAX_SUPPORTED_GEAR) {
      return {
        finalShiftRPM: 0,
        shiftWindow: [0, 0],
        recommendation: "hold",
      };
    }

    if (!this.shiftHistory[gear]) {
      this.shiftHistory[gear] = [];
    }

    if (gear !== this.lastGear && this.lastGear !== 0) {
      // Only trust the outcome of a shift that happened under WOT - a lift-off
      // or partial-throttle gear change doesn't tell us anything about the
      // engine's real shift point.
      if (this.lastThrottle >= this.WOT_THROTTLE_THRESHOLD) {
        this.recordOutcome(this.lastGear, this.lastRPM, speed);
      }
    }

    this.lastGear = gear;
    this.lastRPM = rpm;
    this.lastThrottle = throttle;

    const baselineRPM = this.determineBaselineShiftRPM(
      rpmOptimal,
      maxRpm,
      idleRpm,
      sampleCount,
      ratioToNextGear,
      lookupPower,
      powerCurveSampleCount,
    );
    const learnedRPM = this.calculateLearnedRPM(gear);
    const confidence = Math.min(1, sampleCount / 20);
    let finalShiftRPM = this.calculateFinalShiftRPM(
      baselineRPM,
      learnedRPM,
      maxRpm,
      confidence,
    );

    finalShiftRPM = this.applyGearingSafetyClamp(
      finalShiftRPM,
      maxRpm,
      idleRpm,
      ratioToNextGear,
    );

    const shiftWindow: [number, number] = [
      finalShiftRPM * (1 - this.WINDOW_MARGIN_RATIO),
      finalShiftRPM * (1 + this.WINDOW_MARGIN_RATIO),
    ];

    const recommendation = this.calculateRecommendation(
      rpm,
      finalShiftRPM,
      maxRpm,
      ratioToPreviousGear,
    );

    const lights = this.calculateThrottleAwareShiftLights(
      rpm,
      gear,
      throttle,
      shiftWindow,
    );

    return {
      finalShiftRPM,
      shiftWindow,
      recommendation,
      lights,
    };
  }

  /**
   * Preferred: the true power-curve crossover point (see findCrossoverShiftRPM)
   * once enough WOT samples exist across the whole rev range. Until then, fall
   * back to this gear's own peak-power rpm, or a car-agnostic "near redline"
   * default if even that isn't confident yet.
   */
  private determineBaselineShiftRPM(
    rpmOptimal: number,
    maxRpm: number,
    idleRpm: number,
    sampleCount: number,
    ratioToNextGear: number | null,
    lookupPower: (rpm: number) => number | null,
    powerCurveSampleCount: number,
  ): number {
    if (
      ratioToNextGear !== null &&
      powerCurveSampleCount >= this.MIN_POWER_CURVE_SAMPLES
    ) {
      const crossover = this.findCrossoverShiftRPM(
        lookupPower,
        ratioToNextGear,
        idleRpm,
        maxRpm,
      );
      if (crossover !== null) {
        return crossover;
      }
    }

    if (sampleCount < this.MIN_CONFIDENT_SAMPLES || rpmOptimal <= 0) {
      return maxRpm * this.BOOTSTRAP_REDLINE_RATIO;
    }
    return rpmOptimal;
  }

  /**
   * Finds the rpm at which shifting now already gives equal-or-better power
   * than staying in the current gear: the point where, scanning up from idle,
   * power(rpm * ratioToNextGear) first catches up to power(rpm). Below that
   * point the current gear is still ahead; above it, the next gear already
   * wins, so this is the crossover the two gears' force curves cross at.
   * If the power curve is still rising all the way to redline (never caught
   * up), the correct answer is simply to hold the gear to redline.
   */
  private findCrossoverShiftRPM(
    lookupPower: (rpm: number) => number | null,
    ratioToNextGear: number,
    idleRpm: number,
    maxRpm: number,
  ): number | null {
    if (ratioToNextGear <= 0 || ratioToNextGear >= 1) return null;

    const redlineCap = maxRpm * this.REDLINE_SAFETY_MARGIN_RATIO;
    const step = Math.max(50, maxRpm * 0.01);

    for (let rpm = idleRpm; rpm <= redlineCap; rpm += step) {
      const powerCurrent = lookupPower(rpm);
      const powerNext = lookupPower(rpm * ratioToNextGear);

      if (powerCurrent === null || powerNext === null) continue;

      if (powerNext >= powerCurrent) {
        return rpm;
      }
    }

    return redlineCap;
  }

  private calculateLearnedRPM(gear: number): number {
    const history = this.shiftHistory[gear] || [];
    if (history.length === 0) return 0;

    const rpmBuckets: { [key: number]: number } = {};
    history.forEach((outcome) => {
      const bucket = Math.floor(outcome.rpm / 100) * 100;
      rpmBuckets[bucket] = (rpmBuckets[bucket] || 0) + outcome.score;
    });

    let bestRPM = 0;
    let bestScore = 0;
    Object.entries(rpmBuckets).forEach(([bucket, score]) => {
      if (score > bestScore) {
        bestScore = score;
        bestRPM = parseInt(bucket);
      }
    });

    return bestRPM;
  }

  private calculateFinalShiftRPM(
    baseline: number,
    learned: number,
    maxRpm: number,
    confidence: number,
  ): number {
    let final = baseline * (1 - confidence) + learned * confidence;

    if (learned === 0) {
      final = baseline;
    }

    const minRPM = baseline * 0.9;
    const maxRPM = Math.min(
      maxRpm * this.REDLINE_SAFETY_MARGIN_RATIO,
      baseline * 1.1,
    );

    return Math.max(minRPM, Math.min(maxRPM, final));
  }

  /**
   * Keeps the shift point aware of the gearbox's actual spacing: if shifting
   * at the proposed RPM would drop the next gear below a safe RPM floor
   * (wide-ratio gearbox, e.g. a truck), push the shift point higher instead
   * of lugging the engine after the shift.
   */
  private applyGearingSafetyClamp(
    shiftRPM: number,
    maxRpm: number,
    idleRpm: number,
    ratioToNextGear: number | null,
  ): number {
    const redlineCap = maxRpm * this.REDLINE_SAFETY_MARGIN_RATIO;

    if (!ratioToNextGear || ratioToNextGear <= 0 || ratioToNextGear >= 1) {
      return Math.min(shiftRPM, redlineCap);
    }

    const rpmAfterShift = shiftRPM * ratioToNextGear;
    const floor = idleRpm + this.IDLE_SAFETY_MARGIN_RPM;

    if (rpmAfterShift < floor) {
      const adjusted = floor / ratioToNextGear;
      return Math.min(redlineCap, adjusted);
    }

    return Math.min(shiftRPM, redlineCap);
  }

  private calculateThrottleAwareShiftLights(
    rpm: number,
    gear: number,
    throttle: number,
    shiftWindow: [number, number],
  ): string[] {
    if (
      gear < 1 ||
      gear > MAX_SUPPORTED_GEAR ||
      !shiftWindow ||
      (shiftWindow[0] === 0 && shiftWindow[1] === 0)
    ) {
      return new Array(this.MAX_BUFFER_SIZE).fill("⚫");
    }

    if (throttle < 0.2) {
      return new Array(this.MAX_BUFFER_SIZE).fill("🟢");
    }

    const [windowMin, windowMax] = shiftWindow;
    const windowRange = windowMax - windowMin;

    if (windowRange <= 0) {
      return new Array(this.MAX_BUFFER_SIZE).fill("⚫");
    }

    let normalizedRPM = (rpm - windowMin) / windowRange;
    normalizedRPM = Math.max(0, Math.min(1.2, normalizedRPM));

    const gearFactor = gear / MAX_SUPPORTED_GEAR;
    const aggression = throttle * (0.7 + 0.3 * gearFactor);

    const t1 = 0.35 - 0.1 * aggression;
    const t2 = 0.6 - 0.1 * aggression;
    const t3 = 0.85 - 0.05 * aggression;

    let lightColor: string;

    if (normalizedRPM < t1) {
      lightColor = "🟢";
    } else if (normalizedRPM < t2) {
      lightColor = "🟡";
    } else if (normalizedRPM < t3) {
      lightColor = "🟠";
    } else if (normalizedRPM < 1.0) {
      lightColor = "🔴";
    } else {
      lightColor = this.calculateBlinkingRed(normalizedRPM);
    }

    this.shiftLightBuffer.push(lightColor);
    if (this.shiftLightBuffer.length > this.MAX_BUFFER_SIZE) {
      this.shiftLightBuffer.shift();
    }

    return [...this.shiftLightBuffer];
  }

  private calculateBlinkingRed(normalizedRPM: number): string {
    this.blinkCounter++;

    let blinkSpeed: number;
    if (normalizedRPM > 1.05) {
      blinkSpeed = 2;
    } else if (normalizedRPM > 0.98) {
      blinkSpeed = 4;
    } else {
      blinkSpeed = 8;
    }

    if (this.blinkCounter % blinkSpeed === 0) {
      this.blinkState = !this.blinkState;
    }

    return this.blinkState ? "🔴" : "⚫";
  }

  private calculateRecommendation(
    rpm: number,
    finalShiftRPM: number,
    maxRpm: number,
    ratioToPreviousGear: number | null,
  ): "upshift" | "downshift" | "hold" {
    if (rpm >= finalShiftRPM * 0.98) {
      return "upshift";
    }

    if (rpm <= finalShiftRPM * 0.8) {
      // Gearing-aware guard: don't suggest a downshift that would immediately
      // bounce the engine off the rev limiter in the lower gear.
      if (ratioToPreviousGear !== null && ratioToPreviousGear > 0) {
        const rpmAfterDownshift = rpm * ratioToPreviousGear;
        if (rpmAfterDownshift >= maxRpm * this.REDLINE_SAFETY_MARGIN_RATIO) {
          return "hold";
        }
      }
      return "downshift";
    }

    return "hold";
  }

  private recordOutcome(gear: number, rpm: number, endSpeed: number): void {
    if (gear < 1 || gear > MAX_SUPPORTED_GEAR) return;

    const speedGain = Math.max(0, endSpeed);
    if (speedGain <= 0) return;

    const history = this.shiftHistory[gear];
    history.push({ rpm, score: speedGain, timestamp: Date.now() });

    if (history.length > this.MAX_HISTORY) {
      history.shift();
    }
  }

  exportState(): ShiftHistory {
    return JSON.parse(JSON.stringify(this.shiftHistory));
  }

  importState(state: ShiftHistory): void {
    this.shiftHistory = JSON.parse(JSON.stringify(state ?? {}));
  }

  reset(): void {
    this.shiftHistory = {};
    this.lastGear = 0;
    this.lastRPM = 0;
    this.lastThrottle = 0;
  }
}
