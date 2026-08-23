// Empirically observed rev ceiling: the highest engine rpm ever seen while
// at WOT for the current car build. The engine can't physically exceed its
// real rev limiter no matter what any static field claims, so this
// converges to the true mechanical redline from actual driving - useful for
// cross-checking `engine.maxRpm` against reality rather than trusting it
// blindly (see the redline-accuracy investigation this was built for). A
// passive info stat surfaced to the UI - no active correction logic reads
// it back.
export class RpmCeilingTracker {
  private ceiling = 0;
  private readonly WOT_THROTTLE_THRESHOLD = 0.9;

  update(rpm: number, throttle: number): void {
    if (throttle < this.WOT_THROTTLE_THRESHOLD) return;
    if (rpm > this.ceiling) {
      this.ceiling = rpm;
    }
  }

  getCeiling(): number {
    return this.ceiling;
  }

  reset(): void {
    this.ceiling = 0;
  }
}
