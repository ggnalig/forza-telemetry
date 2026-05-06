import { carConfig } from "../config/car";

export interface ShiftOutcome {
  rpm: number;
  score: number;
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

export class ShiftEngine {
  private shiftHistory: ShiftHistory = {};
  private lastGear: number = 0;
  private lastRPM: number = 0;
  private outcomeFrames: number = 0;
  private shiftLightBuffer: string[] = [];
  private blinkState: boolean = false;
  private blinkCounter: number = 0;
  private readonly MAX_BUFFER_SIZE = 6;
  private readonly MAX_HISTORY = 50;
  private readonly OUTCOME_FRAMES = 5;
  private readonly WINDOW_MARGIN = 0.08;

  update(
    gear: number,
    rpm: number,
    speed: number,
    rpmOptimal: number,
    sampleCount: number,
    throttle: number,
  ): HybridShiftData {
    if (gear < 1 || gear > 6 || gear === 11) {
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
      this.recordOutcome(this.lastGear, this.lastRPM, speed);
      this.outcomeFrames = 0;
    }

    this.lastGear = gear;
    this.lastRPM = rpm;

    if (this.outcomeFrames < this.OUTCOME_FRAMES) {
      this.outcomeFrames++;
    }

    const baselineRPM = this.calculateBaselineRPM(gear, rpm, speed);
    const learnedRPM = this.calculateLearnedRPM(gear);
    const confidence = Math.min(1, sampleCount / 20);
    const finalShiftRPM = this.calculateFinalShiftRPM(
      baselineRPM,
      learnedRPM,
      rpmOptimal,
      confidence,
    );

    const shiftWindow: [number, number] = [
      finalShiftRPM * (1 - this.WINDOW_MARGIN),
      finalShiftRPM * (1 + this.WINDOW_MARGIN),
    ];

    const recommendation = this.calculateRecommendation(
      rpm,
      finalShiftRPM,
      rpmOptimal,
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

  private calculateBaselineRPM(
    gear: number,
    rpm: number,
    speed: number,
  ): number {
    if (speed <= 0) return rpm;
    const shiftSpeed = carConfig.shiftSpeed[gear - 1] || 100;
    return rpm * (shiftSpeed / speed);
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
    optimal: number,
    confidence: number,
  ): number {
    let final = baseline * (1 - confidence) + learned * confidence;

    if (learned === 0) {
      final = baseline;
    }

    const minRPM = optimal * 0.9;
    const maxRPM = optimal * 1.1;

    return Math.max(minRPM, Math.min(maxRPM, final));
  }

  private calculateThrottleAwareShiftLights(
    rpm: number,
    gear: number,
    throttle: number,
    shiftWindow: [number, number],
  ): string[] {
    if (
      gear < 1 ||
      gear > 6 ||
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

    const gearFactor = gear / 6;
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
    rpmOptimal: number,
  ): "upshift" | "downshift" | "hold" {
    if (rpm >= finalShiftRPM * 0.98) {
      return "upshift";
    }
    if (rpm <= rpmOptimal * 0.7) {
      return "downshift";
    }
    return "hold";
  }

  private recordOutcome(gear: number, rpm: number, endSpeed: number): void {
    if (gear < 1 || gear > 6) return;

    const speedGain = Math.max(0, endSpeed);
    if (speedGain <= 0) return;

    const history = this.shiftHistory[gear];
    history.push({ rpm, score: speedGain });

    if (history.length > this.MAX_HISTORY) {
      history.shift();
    }
  }

  reset(): void {
    this.shiftHistory = {};
    this.lastGear = 0;
    this.lastRPM = 0;
    this.outcomeFrames = 0;
  }
}
