export interface TelemetryFrame {
  gear: number;
  rpm: number;
  power: number;
  throttle: number;
  maxRpm: number;
}

export interface GearEfficiencyStats {
  rpmMin: number;
  rpmMax: number;
  rpmAvg: number;
  rpmOptimal: number;
  /** Descriptive p10-p90 spread of rpm actually observed in this gear - NOT
   * a decision boundary. The real shift point is ShiftEngine.finalShiftRPM. */
  observedRpmRange: [number, number];
}

export interface GearEfficiencyMap {
  [gear: number]: GearEfficiencyStats;
}

export interface GearEfficiencySummary {
  [gear: number]: {
    rpmMin: number;
    rpmMax: number;
    rpmAvg: number;
    rpmOptimal: number;
    observedRpmLow: number;
    observedRpmHigh: number;
    wotSampleCount: number;
    totalSampleCount: number;
  };
}

export class GearEfficiencyMapGenerator {
  private efficiencyMap: GearEfficiencyMap = {};
  private totalSampleCounts: { [gear: number]: number } = {};
  private wotSampleCounts: { [gear: number]: number } = {};
  private efficiencyScoreByRpm: {
    [gear: number]: { [rpmBucket: number]: number };
  } = {};
  private rpmSamples: { [gear: number]: number[] } = {};
  private readonly WOT_THROTTLE_THRESHOLD = 0.9;
  private readonly WINDOW_MARGIN_RATIO = 0.02; // % of redline, replaces fixed 250rpm
  private readonly RPM_BUCKET_SIZE = 100;
  private readonly MIN_SAMPLES = 5;
  private readonly MAX_SAMPLES = 100;
  private readonly STABILITY_RPM_RATIO = 0.04; // % of redline, replaces fixed 500rpm

  update(frame: TelemetryFrame): GearEfficiencyMap {
    const { gear, rpm, power, throttle, maxRpm } = frame;
    const windowMargin = maxRpm * this.WINDOW_MARGIN_RATIO;

    if (!this.efficiencyMap[gear]) {
      this.efficiencyMap[gear] = {
        rpmMin: rpm,
        rpmMax: rpm,
        rpmAvg: rpm,
        rpmOptimal: rpm,
        observedRpmRange: [rpm - windowMargin, rpm + windowMargin],
      };
      this.totalSampleCounts[gear] = 1;
      this.wotSampleCounts[gear] = 0;
      this.efficiencyScoreByRpm[gear] = {};
      this.updateRpmSamples(gear, rpm, maxRpm);
      return this.efficiencyMap;
    }

    const currentStats = this.efficiencyMap[gear];
    const currentTotalCount = this.totalSampleCounts[gear];

    this.updateRpmSamples(gear, rpm, maxRpm);

    // RPM distribution tracked from every sample, not just WOT ones,
    // so the shift window stays representative of real driving.
    currentStats.rpmMin = Math.min(currentStats.rpmMin, rpm);
    currentStats.rpmMax = Math.max(currentStats.rpmMax, rpm);
    currentStats.rpmAvg =
      (currentStats.rpmAvg * currentTotalCount + rpm) / (currentTotalCount + 1);
    this.totalSampleCounts[gear] = currentTotalCount + 1;

    // Only wide-open-throttle samples are trusted to represent the engine's
    // actual power curve - partial throttle/coasting samples are noise here.
    if (throttle >= this.WOT_THROTTLE_THRESHOLD) {
      const rpmBucket =
        Math.floor(rpm / this.RPM_BUCKET_SIZE) * this.RPM_BUCKET_SIZE;

      const previousBest = this.efficiencyScoreByRpm[gear][rpmBucket] ?? 0;
      this.efficiencyScoreByRpm[gear][rpmBucket] = Math.max(
        previousBest,
        power,
      );

      const wotCount = this.wotSampleCounts[gear] + 1;
      this.wotSampleCounts[gear] = wotCount;

      if (wotCount >= this.MIN_SAMPLES) {
        const rpmBuckets = Object.keys(this.efficiencyScoreByRpm[gear]).map(
          Number,
        );
        if (rpmBuckets.length > 1) {
          let bestBucket = rpmBuckets[0];
          let bestPower = this.efficiencyScoreByRpm[gear][bestBucket];

          for (const bucket of rpmBuckets) {
            const powerAtBucket = this.efficiencyScoreByRpm[gear][bucket];
            if (powerAtBucket > bestPower) {
              bestPower = powerAtBucket;
              bestBucket = bucket;
            }
          }

          currentStats.rpmOptimal = bestBucket + this.RPM_BUCKET_SIZE / 2;
          currentStats.observedRpmRange = this.calculatePercentileBasedWindow(gear);
        }
      }
    }

    return this.efficiencyMap;
  }

  private isStableRpmSample(rpm: number, gear: number, maxRpm: number): boolean {
    const samples = this.rpmSamples[gear] || [];
    if (samples.length < 3) return true;

    const recentSamples = samples.slice(-3);
    const avgRecent =
      recentSamples.reduce((a, b) => a + b, 0) / recentSamples.length;
    return Math.abs(rpm - avgRecent) < maxRpm * this.STABILITY_RPM_RATIO;
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

  private updateRpmSamples(gear: number, rpm: number, maxRpm: number): void {
    if (!this.rpmSamples[gear]) {
      this.rpmSamples[gear] = [];
    }

    if (this.isStableRpmSample(rpm, gear, maxRpm)) {
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

  /** WOT sample count - used as the confidence signal for shift predictions. */
  getSampleCount(gear: number): number {
    return this.wotSampleCounts[gear] || 0;
  }

  /**
   * Persisted shape is a per-gear summary of the derived stats only - the
   * internal per-bucket power histogram and raw rpm sample buffer are working
   * sets used to *compute* rpmOptimal/observedRpmRange, not the knowledge
   * itself. They naturally rebuild from a few frames of new driving after import.
   */
  exportState(): GearEfficiencySummary {
    const summary: GearEfficiencySummary = {};
    for (const gearKey of Object.keys(this.efficiencyMap)) {
      const gear = Number(gearKey);
      const stats = this.efficiencyMap[gear];
      summary[gear] = {
        rpmMin: stats.rpmMin,
        rpmMax: stats.rpmMax,
        rpmAvg: stats.rpmAvg,
        rpmOptimal: stats.rpmOptimal,
        observedRpmLow: stats.observedRpmRange[0],
        observedRpmHigh: stats.observedRpmRange[1],
        wotSampleCount: this.wotSampleCounts[gear] ?? 0,
        totalSampleCount: this.totalSampleCounts[gear] ?? 0,
      };
    }
    return summary;
  }

  importState(state: GearEfficiencySummary): void {
    this.efficiencyMap = {};
    this.totalSampleCounts = {};
    this.wotSampleCounts = {};
    this.efficiencyScoreByRpm = {};
    this.rpmSamples = {};

    for (const gearKey of Object.keys(state ?? {})) {
      const gear = Number(gearKey);
      const s = state[gear];
      this.efficiencyMap[gear] = {
        rpmMin: s.rpmMin,
        rpmMax: s.rpmMax,
        rpmAvg: s.rpmAvg,
        rpmOptimal: s.rpmOptimal,
        observedRpmRange: [s.observedRpmLow, s.observedRpmHigh],
      };
      this.wotSampleCounts[gear] = s.wotSampleCount;
      this.totalSampleCounts[gear] = s.totalSampleCount;
      this.efficiencyScoreByRpm[gear] = {};
    }
  }

  reset(): void {
    this.efficiencyMap = {};
    this.totalSampleCounts = {};
    this.wotSampleCounts = {};
    this.efficiencyScoreByRpm = {};
    this.rpmSamples = {};
  }
}
