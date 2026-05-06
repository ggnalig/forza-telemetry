export interface TelemetryFrame {
  gear: number;
  rpm: number;
  speed: number;
  torque: number;
}

export interface GearEfficiencyStats {
  rpmMin: number;
  rpmMax: number;
  rpmAvg: number;
  rpmOptimal: number;
  shiftWindow: [number, number];
}

export interface GearEfficiencyMap {
  [gear: number]: GearEfficiencyStats;
}

export interface ShiftRecommendations {
  upshiftRecommended: boolean;
  downshiftRecommended: boolean;
}

export class GearEfficiencyMapGenerator {
  private efficiencyMap: GearEfficiencyMap = {};
  private sampleCounts: { [gear: number]: number } = {};
  private lastSpeedByGear: { [gear: number]: number } = {};
  private efficiencyScoreByRpm: {
    [gear: number]: { [rpmBucket: number]: number };
  } = {};
  private rpmSamples: { [gear: number]: number[] } = {};
  private readonly WINDOW_MARGIN = 250;
  private readonly RPM_BUCKET_SIZE = 100;
  private readonly MIN_SAMPLES = 5;
  private readonly MAX_SAMPLES = 100;
  private readonly STABILITY_RPM_THRESHOLD = 500;

  update(frame: TelemetryFrame): {
    efficiencyMap: GearEfficiencyMap;
    shiftRecommendations: ShiftRecommendations;
  } {
    const { gear, rpm, speed } = frame;

    if (!this.efficiencyMap[gear]) {
      this.efficiencyMap[gear] = {
        rpmMin: rpm,
        rpmMax: rpm,
        rpmAvg: rpm,
        rpmOptimal: rpm,
        shiftWindow: [rpm - this.WINDOW_MARGIN, rpm + this.WINDOW_MARGIN],
      };
      this.sampleCounts[gear] = 1;
      this.lastSpeedByGear[gear] = speed;
      this.efficiencyScoreByRpm[gear] = {};
      return {
        efficiencyMap: this.efficiencyMap,
        shiftRecommendations: {
          upshiftRecommended: false,
          downshiftRecommended: false,
        },
      };
    }

    const currentStats = this.efficiencyMap[gear];
    const currentCount = this.sampleCounts[gear];
    const lastSpeed = this.lastSpeedByGear[gear];

    this.updateRpmSamples(gear, rpm);

    currentStats.rpmMin = Math.min(currentStats.rpmMin, rpm);
    currentStats.rpmMax = Math.max(currentStats.rpmMax, rpm);
    currentStats.rpmAvg =
      (currentStats.rpmAvg * currentCount + rpm) / (currentCount + 1);

    // const speedGain = Math.max(0, speed - lastSpeed);
    const speedGain = Math.max(0, (speed - lastSpeed) * 0.7);
    const rpmBucket =
      Math.floor(rpm / this.RPM_BUCKET_SIZE) * this.RPM_BUCKET_SIZE;

    if (!this.efficiencyScoreByRpm[gear][rpmBucket]) {
      this.efficiencyScoreByRpm[gear][rpmBucket] = 0;
    }
    this.efficiencyScoreByRpm[gear][rpmBucket] += speedGain;

    if (currentCount >= this.MIN_SAMPLES) {
      const rpmBuckets = Object.keys(this.efficiencyScoreByRpm[gear]).map(
        Number,
      );
      if (rpmBuckets.length > 1) {
        let bestBucket = rpmBuckets[0];
        let bestScore = this.efficiencyScoreByRpm[gear][bestBucket];

        for (const bucket of rpmBuckets) {
          const score = this.efficiencyScoreByRpm[gear][bucket];
          if (score > bestScore) {
            bestScore = score;
            bestBucket = bucket;
          }
        }

        currentStats.rpmOptimal = bestBucket + this.RPM_BUCKET_SIZE / 2;
        currentStats.shiftWindow = this.calculatePercentileBasedWindow(gear);
      }
    }

    this.sampleCounts[gear] = currentCount + 1;
    this.lastSpeedByGear[gear] = speed;

    const shiftRecommendations = this.calculateShiftRecommendations(gear, rpm);

    return {
      efficiencyMap: this.efficiencyMap,
      shiftRecommendations,
    };
  }

  private isStableRpmSample(rpm: number, gear: number): boolean {
    const samples = this.rpmSamples[gear] || [];
    if (samples.length < 3) return true;

    const recentSamples = samples.slice(-3);
    const avgRecent =
      recentSamples.reduce((a, b) => a + b, 0) / recentSamples.length;
    return Math.abs(rpm - avgRecent) < this.STABILITY_RPM_THRESHOLD;
  }

  private calculateShiftRecommendations(
    gear: number,
    rpm: number,
  ): ShiftRecommendations {
    const stats = this.efficiencyMap[gear];
    if (!stats || this.sampleCounts[gear] < this.MIN_SAMPLES) {
      return { upshiftRecommended: false, downshiftRecommended: false };
    }

    const [windowMin, windowMax] = stats.shiftWindow;
    const upshiftThreshold = windowMax - 50;
    const downshiftThreshold = windowMin + 50;

    return {
      upshiftRecommended: rpm >= upshiftThreshold,
      downshiftRecommended: rpm <= downshiftThreshold,
    };
  }

  private calculatePercentile(
    sortedSamples: number[],
    percentile: number,
  ): number {
    if (sortedSamples.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedSamples.length) - 1;
    return sortedSamples[
      Math.max(0, Math.min(index, sortedSamples.length - 1))
    ];
  }

  private updateRpmSamples(gear: number, rpm: number): void {
    if (!this.rpmSamples[gear]) {
      this.rpmSamples[gear] = [];
    }

    if (this.isStableRpmSample(rpm, gear)) {
      this.rpmSamples[gear].push(rpm);

      if (this.rpmSamples[gear].length > this.MAX_SAMPLES) {
        this.rpmSamples[gear].shift();
      }
    }
  }

  private calculatePercentileBasedWindow(gear: number): [number, number] {
    const samples = this.rpmSamples[gear] || [];
    if (samples.length < this.MIN_SAMPLES) {
      const currentStats = this.efficiencyMap[gear];
      return [currentStats.rpmMin, currentStats.rpmMax];
    }

    const sortedSamples = [...samples].sort((a, b) => a - b);
    const p10 = this.calculatePercentile(sortedSamples, 10);
    const p90 = this.calculatePercentile(sortedSamples, 90);

    return [p10, p90];
  }

  getEfficiencyMap(): GearEfficiencyMap {
    return { ...this.efficiencyMap };
  }

  reset(): void {
    this.efficiencyMap = {};
    this.sampleCounts = {};
    this.lastSpeedByGear = {};
    this.efficiencyScoreByRpm = {};
    this.rpmSamples = {};
  }
}
