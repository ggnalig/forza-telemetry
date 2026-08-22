// Empirical gear ratio estimator
// Derives each gear's effective rpm-per-speed ratio directly from telemetry
// instead of relying on a hardcoded, car-specific config table.

export interface GearRatioSummary {
  [gear: number]: { ratioMedian: number; sampleCount: number };
}

export class GearRatioEstimator {
  private ratioSamples: { [gear: number]: number[] } = {};
  private readonly MIN_SPEED_KMH = 15;
  private readonly MIN_SAMPLES_FOR_RATIO = 5;
  private readonly MAX_SAMPLES = 50;

  /**
   * Feed one telemetry frame. Only frames with meaningful forward speed are
   * used, to avoid the rpm/speed ratio blowing up near a stop.
   */
  update(gear: number, rpm: number, speedKmh: number): void {
    if (gear < 1 || rpm <= 0 || speedKmh < this.MIN_SPEED_KMH) {
      return;
    }

    if (!this.ratioSamples[gear]) {
      this.ratioSamples[gear] = [];
    }

    const samples = this.ratioSamples[gear];
    samples.push(rpm / speedKmh);

    if (samples.length > this.MAX_SAMPLES) {
      samples.shift();
    }
  }

  /**
   * Median rpm/speed ratio for a gear, or null until enough samples exist.
   * Median is used (instead of mean) to stay robust against wheelspin/slip outliers.
   */
  getRatio(gear: number): number | null {
    const samples = this.ratioSamples[gear];
    if (!samples || samples.length < this.MIN_SAMPLES_FOR_RATIO) {
      return null;
    }

    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  /**
   * Ratio of (next gear's rpm/speed ratio) to (current gear's), i.e. how much
   * rpm drops after an upshift at constant speed. Always < 1 for a real gearbox.
   * Returns null if either gear hasn't been observed enough yet.
   */
  getRatioToNextGear(gear: number): number | null {
    return this.ratioBetween(gear, gear + 1);
  }

  /**
   * Ratio of (previous gear's rpm/speed ratio) to (current gear's), i.e. how
   * much rpm jumps up after a downshift at constant speed. Always > 1 for a
   * real gearbox. Returns null if either gear hasn't been observed enough yet.
   */
  getRatioToPreviousGear(gear: number): number | null {
    if (gear <= 1) return null;
    return this.ratioBetween(gear, gear - 1);
  }

  private ratioBetween(fromGear: number, toGear: number): number | null {
    const from = this.getRatio(fromGear);
    const to = this.getRatio(toGear);

    if (from === null || to === null || from === 0) {
      return null;
    }

    return to / from;
  }

  /**
   * Persisted shape is a summary (median + sample count), not the raw rolling
   * buffer - that buffer is a working set for computing the median, not
   * itself "the learned knowledge" worth keeping in a human-readable store.
   */
  exportState(): GearRatioSummary {
    const summary: GearRatioSummary = {};
    for (const gearKey of Object.keys(this.ratioSamples)) {
      const gear = Number(gearKey);
      const median = this.getRatio(gear);
      if (median !== null) {
        summary[gear] = {
          ratioMedian: median,
          sampleCount: this.ratioSamples[gear].length,
        };
      }
    }
    return summary;
  }

  /**
   * Reconstructs a buffer from the summary by repeating the median - this
   * reproduces the same median and sample count (confidence) going forward,
   * without needing every individual historical sample.
   */
  importState(state: GearRatioSummary): void {
    this.ratioSamples = {};
    for (const gearKey of Object.keys(state ?? {})) {
      const gear = Number(gearKey);
      const { ratioMedian, sampleCount } = state[gear];
      const count = Math.max(0, Math.min(sampleCount, this.MAX_SAMPLES));
      this.ratioSamples[gear] = new Array(count).fill(ratioMedian);
    }
  }

  reset(): void {
    this.ratioSamples = {};
  }
}
