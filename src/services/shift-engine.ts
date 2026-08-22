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
  /** Highest power observed on the pooled curve, from EnginePowerCurve.getPeakPower(). */
  peakPower: number | null;
  brake: number;
}

type DownshiftMode = "power" | "braking";

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
  private downshiftMode: DownshiftMode = "power";
  private readonly MAX_BUFFER_SIZE = 10;
  private readonly MAX_HISTORY = 50;
  private readonly WINDOW_MARGIN_RATIO = 0.08;
  private readonly WOT_THROTTLE_THRESHOLD = 0.9;
  private readonly MIN_CONFIDENT_SAMPLES = 5;
  private readonly MIN_POWER_CURVE_SAMPLES = 20;
  private readonly BOOTSTRAP_REDLINE_RATIO = 0.92;
  private readonly REDLINE_SAFETY_MARGIN_RATIO = 0.98;
  private readonly IDLE_SAFETY_MARGIN_RPM = 300;
  // Hysteresis for power-driven vs. braking-driven downshift mode: entering
  // and exiting braking mode use different throttle thresholds on purpose, so
  // trail-braking/heel-toe (throttle hovering near one value) can't flap the
  // mode back and forth every frame.
  private readonly ENTER_BRAKING_THROTTLE = 0.15;
  private readonly ENTER_BRAKING_BRAKE = 0.5;
  private readonly EXIT_BRAKING_THROTTLE = 0.35;
  // "Meat of the powerband" for the braking mode's target rpm: the lowest rpm
  // where observed power reaches this fraction of the car's peak power.
  private readonly BRAKING_BAND_POWER_RATIO = 0.7;
  // Fallback (before enough power-curve data exists) is expressed relative to
  // the idle-to-redline range, not raw maxRpm, so high-idle vehicles (trucks)
  // aren't shortchanged.
  private readonly BRAKING_BAND_FALLBACK_LOW_RATIO = 0.35;

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
      brake,
      ratioToNextGear,
      ratioToPreviousGear,
      lookupPower,
      powerCurveSampleCount,
      peakPower,
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

    const mode = this.updateDownshiftMode(throttle, brake);
    const downshiftRPM = this.determineDownshiftRPM(
      mode,
      maxRpm,
      idleRpm,
      ratioToPreviousGear,
      lookupPower,
      peakPower,
      powerCurveSampleCount,
    );

    const recommendation = this.calculateRecommendation(
      rpm,
      finalShiftRPM,
      downshiftRPM,
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

  /**
   * Downshifting happens in two physically different situations, so the
   * criteria for "when" differ too:
   *  - power-driven: throttle applied, gear is underpowered at this rpm -> use
   *    the same force-curve crossover math as upshift, just viewed from the
   *    lower gear's perspective.
   *  - braking-driven (corner entry): no power is being applied, so a power
   *    comparison is meaningless - instead aim to land in the productive part
   *    of the powerband, ready to accelerate out.
   * Hysteresis (different enter/exit throttle thresholds) prevents the mode
   * from flapping every frame during trail-braking/heel-toe, where throttle
   * hovers near the boundary instead of jumping cleanly between 0 and 1.
   */
  private updateDownshiftMode(throttle: number, brake: number): DownshiftMode {
    if (this.downshiftMode === "braking") {
      if (throttle >= this.EXIT_BRAKING_THROTTLE) {
        this.downshiftMode = "power";
      }
    } else if (
      throttle < this.ENTER_BRAKING_THROTTLE &&
      brake > this.ENTER_BRAKING_BRAKE
    ) {
      this.downshiftMode = "braking";
    }

    return this.downshiftMode;
  }

  /**
   * Rpm below which a downshift is recommended, or null if there isn't enough
   * data yet to compute either mode's answer (caller falls back to a plain
   * heuristic in that case).
   */
  private determineDownshiftRPM(
    mode: DownshiftMode,
    maxRpm: number,
    idleRpm: number,
    ratioToPreviousGear: number | null,
    lookupPower: (rpm: number) => number | null,
    peakPower: number | null,
    powerCurveSampleCount: number,
  ): number | null {
    if (mode === "braking") {
      return this.findBrakingTargetRpm(
        lookupPower,
        peakPower,
        powerCurveSampleCount,
        idleRpm,
        maxRpm,
      );
    }

    if (
      ratioToPreviousGear === null ||
      ratioToPreviousGear <= 1 ||
      powerCurveSampleCount < this.MIN_POWER_CURVE_SAMPLES
    ) {
      return null;
    }

    // Reuse the upshift crossover math with the reciprocal ratio: this is
    // exactly the crossover the lower gear (gear-1) would compute for its own
    // upshift-to-this-gear, which is the same physical boundary that decides
    // "should I downshift from here to gear-1".
    const ratioToNextGearOfLowerGear = 1 / ratioToPreviousGear;
    const crossoverInLowerGearUnits = this.findCrossoverShiftRPM(
      lookupPower,
      ratioToNextGearOfLowerGear,
      idleRpm,
      maxRpm,
    );

    if (crossoverInLowerGearUnits === null) return null;

    return crossoverInLowerGearUnits / ratioToPreviousGear;
  }

  /**
   * Lowest rpm where observed power reaches BRAKING_BAND_POWER_RATIO of the
   * car's peak power - the bottom edge of "the meat of the powerband", used
   * as the target to have reached by the time the driver gets back on
   * throttle. Falls back to a proportional guess (relative to idle-to-redline
   * range) until enough power-curve data exists.
   */
  private findBrakingTargetRpm(
    lookupPower: (rpm: number) => number | null,
    peakPower: number | null,
    powerCurveSampleCount: number,
    idleRpm: number,
    maxRpm: number,
  ): number {
    if (
      peakPower !== null &&
      peakPower > 0 &&
      powerCurveSampleCount >= this.MIN_POWER_CURVE_SAMPLES
    ) {
      const threshold = peakPower * this.BRAKING_BAND_POWER_RATIO;
      const step = Math.max(50, maxRpm * 0.01);

      for (let rpm = idleRpm; rpm <= maxRpm; rpm += step) {
        const power = lookupPower(rpm);
        if (power !== null && power >= threshold) {
          return rpm;
        }
      }
    }

    return idleRpm + (maxRpm - idleRpm) * this.BRAKING_BAND_FALLBACK_LOW_RATIO;
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
    downshiftRPM: number | null,
    maxRpm: number,
    ratioToPreviousGear: number | null,
  ): "upshift" | "downshift" | "hold" {
    if (rpm >= finalShiftRPM * 0.98) {
      return "upshift";
    }

    // Prefer the mode-aware crossover/band answer; fall back to the old plain
    // heuristic if there isn't enough data yet for either downshift mode.
    const threshold = downshiftRPM ?? finalShiftRPM * 0.8;

    if (rpm <= threshold) {
      // Gearing-aware guard: don't suggest a downshift that would immediately
      // bounce the engine off the rev limiter in the lower gear. This applies
      // regardless of which mode produced the threshold above.
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
    this.downshiftMode = "power";
  }
}
