// Gear-Aware Shift System V3 - RPM Puncak Alternative
// LED visualization based on RPM progress within each gear - more intuitive for drivers

import { TelemetryData } from "../types/telemetry";
import { GearConfigService } from "../config/gear-config";

export interface ShiftData {
  state: "OFF" | "EARLY" | "OPTIMAL" | "LATE";
  light: "⚫" | "🟢" | "🔵" | "🔴";
  rpm: number;
  rpmAfterShift: number | null;
  rpmDrop: number | null;
  optimal: boolean;
  reason: string;
  mode: "RPM" | "POWER" | "GEAR";
  blink: boolean;
  progressive: string[];
  debug?: {
    currentGear?: number;
    nextGear?: number;
    currentRatio?: number;
    nextRatio?: number;
    rpm?: number;
    rpmRatio?: number;
    rpmProgressInGear?: number; // NEW: RPM progress within current gear
    optimalShiftPoint?: number; // NEW: Optimal shift point for this gear
    thresholds?: object;
  };
}

export class GearAwareShiftService {
  private readonly PROGRESSIVE_STEPS = 6;
  private readonly THROTTLE_THRESHOLD = 0.2;
  private readonly BLINK_THRESHOLD = 0.98; // 98% of max RPM
  private readonly BLINK_INTERVAL = 150; // ms

  // V3: Gear-aware shift thresholds
  private readonly MIN_POWER_BAND_RPM = 3500; // Minimum RPM to stay in power band

  private gearConfigService: GearConfigService;

  constructor() {
    this.gearConfigService = new GearConfigService();
  }

  /**
   * V3: Calculate gear-aware shift indicators based on RPM after shift
   */
  public calculateShift(telemetry: TelemetryData): ShiftData {
    const { engine, input } = telemetry;
    const { rpm, maxRpm } = engine;
    const { throttle, gear } = input;

    // V3: Guards - throttle and gear
    if (throttle < this.THROTTLE_THRESHOLD) {
      return this.getOffState("THROTTLE_OFF");
    }

    if (gear === 0) {
      return this.getOffState("GEAR_0_OR_INVALID");
    }

    // V3: Edge case handling
    if (maxRpm <= 0 || isNaN(rpm) || isNaN(maxRpm)) {
      return this.getOffState("INVALID_RPM");
    }

    // V3: Get gear data
    const currentRatio = this.gearConfigService.getGearRatio(gear);
    const nextRatio = this.gearConfigService.getNextGearRatio(gear);

    if (!currentRatio || !nextRatio) {
      return this.getOffState("NO_GEAR_DATA");
    }

    // V3: Calculate RPM after shift
    const rpmAfterShift = this.calculateRpmAfterShift(
      rpm,
      currentRatio,
      nextRatio,
    );
    const rpmDrop = rpm - rpmAfterShift;

    // V3: Determine shift state based on gear ratios
    const state = this.determineShiftState(rpm, rpmAfterShift, maxRpm);
    const blink = this.shouldBlink(rpm, maxRpm, telemetry.timestamp);

    // V3: RPM Puncak-based LED visualization (ALTERNATIVE)
    const progressive = this.generateProgressiveLedsV3_RPM_PEAK(
      rpm,
      maxRpm,
      state,
      blink,
      gear,
      currentRatio,
      nextRatio,
    );

    // V3: State ↔ LED synchronization
    const synchronizedState = this.synchronizeStateWithLEDs(state, progressive);

    const shiftData: ShiftData = {
      state: synchronizedState,
      light: this.mapStateToLight(synchronizedState),
      rpm,
      rpmAfterShift,
      rpmDrop,
      optimal: synchronizedState === "OPTIMAL",
      reason: this.getReason(synchronizedState),
      mode: "GEAR",
      blink,
      progressive,
      debug: {
        currentGear: gear,
        nextGear: gear + 1,
        currentRatio,
        nextRatio,
        rpm,
        rpmRatio: rpm / maxRpm,
        rpmProgressInGear: this.calculateRpmProgressInGear(
          rpm,
          maxRpm,
          gear,
          currentRatio,
        ),
        optimalShiftPoint: this.calculateOptimalShiftPoint(
          gear,
          currentRatio,
          nextRatio,
        ),
      },
    };

    return shiftData;
  }

  /**
   * V3: Calculate RPM after shift based on gear ratios
   */
  private calculateRpmAfterShift(
    currentRpm: number,
    currentRatio: number,
    nextRatio: number,
  ): number {
    // RPM after shift = currentRPM * (nextGearRatio / currentGearRatio)
    return currentRpm * (nextRatio / currentRatio);
  }

  /**
   * V3: Determine shift state based on gear ratios and RPM after shift
   */
  private determineShiftState(
    currentRpm: number,
    rpmAfterShift: number,
    maxRpm: number,
  ): "OFF" | "EARLY" | "OPTIMAL" | "LATE" {
    const maxSafeRpm = maxRpm * 0.98; // 98% of max RPM

    // V3: LATE state - approaching rev limiter
    if (currentRpm >= maxSafeRpm) {
      return "LATE";
    }

    // V3: EARLY state - RPM drop would be too low
    if (rpmAfterShift < this.MIN_POWER_BAND_RPM) {
      return "EARLY";
    }

    // V3: OPTIMAL state - good shift window
    if (rpmAfterShift >= this.MIN_POWER_BAND_RPM && currentRpm < maxSafeRpm) {
      return "OPTIMAL";
    }

    // V3: Default to EARLY if conditions aren't met
    return "EARLY";
  }

  /**
   * V3: NEW - Calculate RPM progress within current gear (0-1)
   * This shows how close we are to the practical RPM limit for this gear
   */
  private calculateRpmProgressInGear(
    currentRpm: number,
    maxRpm: number,
    currentGear: number,
    currentRatio: number,
  ): number {
    // Lower gears can rev higher practically due to shorter ratios
    // Higher gears should shift earlier for efficiency
    const gearFactor = Math.max(0.5, 1 - (currentGear - 1) * 0.08); // 1st=1.0, 6th=0.6
    const practicalMaxRpm = maxRpm * gearFactor;

    // Also consider gear ratio - shorter ratios = higher practical RPM
    const ratioFactor = Math.min(1.0, currentRatio / 2.0); // Normalize
    const adjustedMaxRpm = practicalMaxRpm * (0.8 + ratioFactor * 0.2);

    return Math.min(1, currentRpm / adjustedMaxRpm);
  }

  /**
   * V3: NEW - Calculate optimal shift point for this gear
   * Based on gear ratio spread and power band characteristics
   */
  private calculateOptimalShiftPoint(
    _currentGear: number,
    currentRatio: number,
    nextRatio: number,
  ): number {
    // Calculate gear spread (how much RPM drops)
    const gearSpread = nextRatio / currentRatio;

    // Close ratio gears (small drop) = shift later
    // Wide ratio gears (big drop) = shift earlier
    if (gearSpread > 0.8) {
      return 0.85; // Close ratio: shift at 85% of practical max
    } else if (gearSpread < 0.6) {
      return 0.75; // Wide ratio: shift at 75% of practical max
    } else {
      return 0.8; // Normal ratio: shift at 80% of practical max
    }
  }

  /**
   * V3: NEW - RPM Puncak-based LED visualization
   * More intuitive for drivers - shows RPM progress within current gear
   */
  private generateProgressiveLedsV3_RPM_PEAK(
    currentRpm: number,
    maxRpm: number,
    state: string,
    blink: boolean,
    currentGear: number,
    currentRatio: number,
    nextRatio: number,
  ): string[] {
    // Calculate RPM progress within current gear (0-1)
    const rpmProgress = this.calculateRpmProgressInGear(
      currentRpm,
      maxRpm,
      currentGear,
      currentRatio,
    );

    // Calculate optimal shift point for this gear
    const optimalShiftPoint = this.calculateOptimalShiftPoint(
      currentGear,
      currentRatio,
      nextRatio,
    );

    // Calculate practical max RPM for this gear
    // const gearFactor = Math.max(0.5, 1 - (currentGear - 1) * 0.08);
    // const practicalMaxRpm = maxRpm * gearFactor; // Not used in this function

    // Determine LED activation based on RPM progress
    const activeLeds = Math.floor(rpmProgress * this.PROGRESSIVE_STEPS);
    const leds: string[] = [];

    for (let i = 0; i < this.PROGRESSIVE_STEPS; i++) {
      const ledPosition = (i + 1) / this.PROGRESSIVE_STEPS; // 0.17, 0.33, 0.5, 0.67, 0.83, 1.0

      if (i >= activeLeds) {
        // LED is off
        leds.push("⚫");
      } else if (blink && currentRpm >= maxRpm * this.BLINK_THRESHOLD) {
        // Blinking red for rev limiter
        leds.push("🔴");
      } else if (state === "LATE") {
        // Late state - all red LEDs (approaching rev limiter)
        leds.push("🔴");
      } else if (state === "OPTIMAL") {
        // Optimal state - approaching optimal shift point
        if (ledPosition >= optimalShiftPoint) {
          leds.push("🔵"); // Blue: Time to shift!
        } else if (ledPosition >= optimalShiftPoint - 0.2) {
          leds.push("🟡"); // Yellow: Getting close to shift point
        } else {
          leds.push("🟢"); // Green: Building up RPM
        }
      } else if (state === "EARLY") {
        // Early state - building up RPM, not close to optimal yet
        if (ledPosition >= 0.5) {
          leds.push("🟡"); // Yellow: Approaching reasonable RPM
        } else {
          leds.push("🟢"); // Green: Still building up
        }
      } else {
        // Default progression based on RPM progress only
        if (ledPosition >= 0.8) {
          leds.push("🔴"); // Red: Approaching limit
        } else if (ledPosition >= 0.5) {
          leds.push("🟡"); // Yellow: Building up
        } else {
          leds.push("🟢"); // Green: Low RPM
        }
      }
    }

    return leds;
  }

  /**
   * V3: Map shift state to emoji light
   */
  private mapStateToLight(
    state: "OFF" | "EARLY" | "OPTIMAL" | "LATE",
  ): "⚫" | "🟢" | "🔵" | "🔴" {
    switch (state) {
      case "OFF":
        return "⚫";
      case "EARLY":
        return "🟢";
      case "OPTIMAL":
        return "🔵";
      case "LATE":
        return "🔴";
      default:
        return "⚫";
    }
  }

  /**
   * V3: Get reason for current shift state
   */
  private getReason(state: string): string {
    switch (state) {
      case "OFF":
        return "THROTTLE_OFF";
      case "EARLY":
        return "RPM_DROP_TOO_LOW";
      case "OPTIMAL":
        return "GOOD_SHIFT_WINDOW";
      case "LATE":
        return "OVER_REV";
      default:
        return "UNKNOWN";
    }
  }

  /**
   * V3: Determine if LED should blink (rev limiter)
   */
  private shouldBlink(
    currentRpm: number,
    maxRpm: number,
    timestamp: number,
  ): boolean {
    if (currentRpm >= maxRpm * this.BLINK_THRESHOLD) {
      return Math.floor(timestamp / this.BLINK_INTERVAL) % 2 === 0;
    }
    return false;
  }

  /**
   * V3: Synchronize state with LED display
   */
  private synchronizeStateWithLEDs(
    state: "OFF" | "EARLY" | "OPTIMAL" | "LATE",
    progressive: string[],
  ): "OFF" | "EARLY" | "OPTIMAL" | "LATE" {
    // Find last active LED
    const lastActiveIndex = progressive.findIndex((led) => led !== "⚫");
    const lastActiveLED =
      lastActiveIndex >= 0 ? progressive[lastActiveIndex] : "⚫";

    // V3: Rule - if last active LED is 🔴, force state to LATE
    if (lastActiveLED === "🔴" && state !== "LATE") {
      return "LATE";
    }

    return state;
  }

  /**
   * V3: Get off state (no shifting needed)
   */
  private getOffState(reason: string): ShiftData {
    return {
      state: "OFF",
      light: "⚫",
      rpm: 0,
      rpmAfterShift: null,
      rpmDrop: null,
      optimal: false,
      reason,
      mode: "GEAR",
      blink: false,
      progressive: ["⚫", "⚫", "⚫", "⚫", "⚫", "⚫"],
    };
  }

  /**
   * V3: Format shift data for console output with gear-aware information
   */
  public formatForConsole(shift: ShiftData): string {
    const progressiveStr = shift.progressive.join("");
    const blinkIndicator = shift.blink ? " (BLINK)" : "";

    if (shift.state === "OPTIMAL" && shift.rpmAfterShift !== null) {
      return `${progressiveStr} | ${shift.state} | rpmAfter: ${Math.round(shift.rpmAfterShift)}${blinkIndicator}`;
    } else if (shift.state === "EARLY" && shift.rpmDrop !== null) {
      return `${progressiveStr} | ${shift.state} | rpmDrop: ${Math.round(shift.rpmDrop)}${blinkIndicator}`;
    } else {
      return `${progressiveStr} | ${shift.state} | rpm: ${shift.rpm}${blinkIndicator}`;
    }
  }
}
