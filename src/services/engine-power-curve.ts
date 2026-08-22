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
   * buckets. Returns null if no data has been collected yet, OR if rpm falls
   * outside the recorded range.
   *
   * Deliberately does NOT clamp/extrapolate to the nearest edge bucket: a
   * crossover scan compares power(rpm) against power(rpm * someRatio) at many
   * points, and if both ends of that comparison fall outside the recorded
   * range they'd clamp to the SAME edge value and look like a "tie" - which
   * findCrossoverShiftRPM reads as an immediate (bogus) crossover right at
   * the first rpm it checks. Returning null instead lets callers skip those
   * points, exactly like they already skip "no data at all" gaps.
   */
  getPowerAt(rpm: number): number | null {
    const buckets = Object.keys(this.powerByRpmBucket)
      .map(Number)
      .sort((a, b) => a - b);

    if (buckets.length === 0) return null;
    if (rpm < buckets[0] || rpm > buckets[buckets.length - 1]) return null;
    if (rpm === buckets[0]) return this.powerByRpmBucket[buckets[0]];
    if (rpm === buckets[buckets.length - 1]) {
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

  /** Highest power observed across the whole curve, or null if no data yet. */
  getPeakPower(): number | null {
    const values = Object.values(this.powerByRpmBucket);
    if (values.length === 0) return null;
    return Math.max(...values);
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
