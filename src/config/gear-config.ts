// Gear Configuration Service for Gear-Aware Shift System V3
// Provides gear ratios and final drive information for realistic shift timing

export interface GearConfigProvider {
  getGearRatio(gear: number): number | null;
  getNextGearRatio(gear: number): number | null;
  getFinalDrive(): number;
}

export class GearConfigService implements GearConfigProvider {
  private readonly gearConfig = {
    finalDrive: 3.63,
    gears: {
      1: 2.89,
      2: 1.99,
      3: 1.49,
      4: 1.16,
      5: 0.94,
      6: 0.78,
    },
  };

  /**
   * Get gear ratio for specific gear
   */
  public getGearRatio(gear: number): number | null {
    return (
      this.gearConfig.gears[gear as keyof typeof this.gearConfig.gears] || null
    );
  }

  /**
   * Get next gear ratio (for upshift calculation)
   */
  public getNextGearRatio(gear: number): number | null {
    const nextGear = gear + 1;
    return this.getGearRatio(nextGear);
  }

  /**
   * Get final drive ratio
   */
  public getFinalDrive(): number {
    return this.gearConfig.finalDrive;
  }

  /**
   * Calculate RPM after shift based on current RPM and gear ratios
   */
  public calculateRpmAfterShift(
    currentRpm: number,
    currentGear: number,
  ): number | null {
    const currentRatio = this.getGearRatio(currentGear);
    const nextRatio = this.getNextGearRatio(currentGear);

    if (!currentRatio || !nextRatio) {
      return null;
    }

    // RPM after shift = currentRPM * (nextGearRatio / currentGearRatio)
    return currentRpm * (nextRatio / currentRatio);
  }

  /**
   * Get all available gear ratios
   */
  public getAllGearRatios(): Record<number, number> {
    return { ...this.gearConfig.gears };
  }

  /**
   * Check if gear has next gear (not last gear)
   */
  public hasNextGear(gear: number): boolean {
    return this.getNextGearRatio(gear) !== null;
  }
}
