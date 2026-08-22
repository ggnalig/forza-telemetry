// Engine power-vs-rpm curve, pooled across ALL gears.
// An engine's torque/power output at a given rpm is a property of the engine
// itself, not the gear it happens to be in - pooling samples from every gear
// (instead of learning a separate curve per gear) converges much faster and
// gives ShiftEngine a real approximation of the WOT power curve to compare
// across a gear change.

export class EnginePowerCurve {
  private powerByRpmBucket: { [rpmBucket: number]: number } = {};
  private sampleCount = 0;
  private readonly WOT_THROTTLE_THRESHOLD = 0.9;

  update(rpm: number, powerKw: number, throttle: number, maxRpm: number): void {
    if (throttle < this.WOT_THROTTLE_THRESHOLD || rpm <= 0 || powerKw <= 0) {
      return;
    }

    const bucketSize = this.bucketSize(maxRpm);
    const bucket = Math.floor(rpm / bucketSize) * bucketSize;
    const previousBest = this.powerByRpmBucket[bucket] ?? 0;
    this.powerByRpmBucket[bucket] = Math.max(previousBest, powerKw);
    this.sampleCount++;
  }

  getSampleCount(): number {
    return this.sampleCount;
  }

  /**
   * Power at a given rpm, linearly interpolated between the nearest known
   * buckets. Returns null if no data has been collected yet.
   */
  getPowerAt(rpm: number): number | null {
    const buckets = Object.keys(this.powerByRpmBucket)
      .map(Number)
      .sort((a, b) => a - b);

    if (buckets.length === 0) return null;
    if (rpm <= buckets[0]) return this.powerByRpmBucket[buckets[0]];
    if (rpm >= buckets[buckets.length - 1]) {
      return this.powerByRpmBucket[buckets[buckets.length - 1]];
    }

    for (let i = 0; i < buckets.length - 1; i++) {
      const lower = buckets[i];
      const upper = buckets[i + 1];
      if (rpm >= lower && rpm <= upper) {
        const t = (rpm - lower) / (upper - lower);
        return (
          this.powerByRpmBucket[lower] * (1 - t) +
          this.powerByRpmBucket[upper] * t
        );
      }
    }

    return null;
  }

  private bucketSize(maxRpm: number): number {
    return Math.max(50, maxRpm * 0.01);
  }

  exportState(): { powerByRpmBucket: { [rpmBucket: number]: number }; sampleCount: number } {
    return {
      powerByRpmBucket: { ...this.powerByRpmBucket },
      sampleCount: this.sampleCount,
    };
  }

  importState(state: {
    powerByRpmBucket: { [rpmBucket: number]: number };
    sampleCount: number;
  }): void {
    this.powerByRpmBucket = { ...(state?.powerByRpmBucket ?? {}) };
    this.sampleCount = state?.sampleCount ?? 0;
  }

  reset(): void {
    this.powerByRpmBucket = {};
    this.sampleCount = 0;
  }
}
