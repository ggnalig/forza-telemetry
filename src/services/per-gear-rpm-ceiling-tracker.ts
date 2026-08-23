// Empirically observed rev ceiling PER GEAR - the live, auto-populating
// counterpart to RpmCeilingTracker (which only tracks one global number and
// is a passive read-only stat). This one feeds directly into
// TelemetryProcessor.computeEffectiveRpm(), so the gauge's per-gear scale
// self-corrects while driving instead of requiring a trip to Car Settings
// to manually type in an observed number (see the auto-tune-detection
// memory for why this exists).
//
// Seeded from whatever's already persisted on the active tune's
// maxRpmPerGearOverride, and only ever grows upward from there - a value
// this tracker reports is always at least as high as what's on disk, never
// lower, so callers can treat it as the authoritative "best known ceiling
// so far" without needing to separately compare against the persisted map.
export class PerGearRpmCeilingTracker {
  private ceilings: Record<number, number> = {};
  private readonly WOT_THROTTLE_THRESHOLD = 0.9;

  /** Replaces all tracked ceilings - call whenever the active car/tune
   * changes, seeding from that tune's own persisted overrides (or {} for a
   * fresh/untuned car). */
  seed(initial: Record<number, number>): void {
    this.ceilings = { ...initial };
  }

  /** Call once per frame. Returns true if this frame raised the ceiling for
   * `gear` (i.e. there's something new worth persisting). */
  update(gear: number, rpm: number, throttle: number): boolean {
    if (throttle < this.WOT_THROTTLE_THRESHOLD) return false;
    const current = this.ceilings[gear];
    if (current === undefined || rpm > current) {
      this.ceilings[gear] = rpm;
      return true;
    }
    return false;
  }

  getCeiling(gear: number): number | undefined {
    return this.ceilings[gear];
  }

  getAll(): Record<number, number> {
    return { ...this.ceilings };
  }
}
