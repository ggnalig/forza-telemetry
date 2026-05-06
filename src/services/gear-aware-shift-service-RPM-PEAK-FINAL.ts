// Gear-Aware Shift System V3 - RPM PUNCAK GEAR RATIO Alternative
// TRULY intuitive gear-based shifting with RPM peak approach

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
    rpmProgressInGear?: number; // NEW: RPM progress in current gear
    gearCharacteristics?: object; // NEW: Gear-specific characteristics
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

    // V3: ALTERNATIF - RPM Puncak Gear Ratio visualization
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
        gearCharacteristics: this.getGearCharacteristics(
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
   * V3: NEW - Calculate RPM progress in current gear (0-1)
   * This shows how close we are to the practical limit of current gear
   */
  private calculateRpmProgressInGear(
    currentRpm: number,
    maxRpm: number,
    currentGear: number,
    _currentRatio: number,
  ): number {
    // Calculate practical RPM limit for this gear
    // Higher gears have lower practical limits due to power dropoff
    const gearFactor = Math.max(0.5, 1 - (currentGear - 1) * 0.08); // 8% reduction per gear
    const practicalMaxRpm = maxRpm * gearFactor;

    // Calculate progress (0-1)
    return Math.min(1, currentRpm / practicalMaxRpm);
  }

  /**
   * V3: NEW - Get gear characteristics for visualization
   */
  private getGearCharacteristics(
    currentGear: number,
    currentRatio: number,
    nextRatio: number,
  ): object {
    const gearSpread = nextRatio / currentRatio;
    const isCloseRatio = gearSpread > 0.75;
    const isWideRatio = gearSpread < 0.65;

    return {
      gearSpread,
      isCloseRatio,
      isWideRatio,
      ratioType: isCloseRatio ? "CLOSE" : isWideRatio ? "WIDE" : "NORMAL",
      shiftPoint: this.calculateOptimalShiftPoint(
        currentGear,
        currentRatio,
        nextRatio,
      ),
    };
  }

  /**
   * V3: NEW - Calculate optimal shift point for this gear
   */
  private calculateOptimalShiftPoint(
    _currentGear: number,
    currentRatio: number,
    nextRatio: number,
  ): number {
    // For close ratio gears, shift later
    // For wide ratio gears, shift earlier
    const gearSpread = nextRatio / currentRatio;

    if (gearSpread > 0.8) {
      return 0.85; // Close ratio: shift at 85% of max
    } else if (gearSpread < 0.6) {
      return 0.75; // Wide ratio: shift at 75% of max
    } else {
      return 0.8; // Normal ratio: shift at 80% of max
    }
  }

  /**
   * V3: ALTERNATIF - RPM Puncak Gear Ratio visualization
   * TRULY intuitive - shows how close to gear's practical peak
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
    // Calculate RPM progress in current gear (0-1)
    const rpmProgressInGear = this.calculateRpmProgressInGear(
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

    // Use exponential bias for realistic progression
    const biasedRatio = Math.pow(rpmProgressInGear, 1.3); // Slightly less aggressive than 1.5
    const activeLeds = Math.floor(biasedRatio * this.PROGRESSIVE_STEPS);
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
        // OPTIMAL state - based on RPM progress in gear
        if (ledPosition >= optimalShiftPoint + 0.1) {
          leds.push("🔵"); // Blue: Past optimal shift point
        } else if (ledPosition >= optimalShiftPoint - 0.05) {
          leds.push("🟡"); // Yellow: At optimal shift window
        } else if (ledPosition >= optimalShiftPoint - 0.15) {
          leds.push("🟡"); // Yellow: Approaching optimal
        } else {
          leds.push("🟢"); // Green: Still building up
        }
      } else if (state === "EARLY") {
        // EARLY state - based on RPM progress
        if (ledPosition >= 0.7) {
          leds.push("🟡"); // Yellow: Approaching power band
        } else {
          leds.push("🟢"); // Green: Early/low RPM
        }
      } else {
        // Default progression based on RPM progress in gear
        if (ledPosition >= 0.85) {
          leds.push("🔴");
        } else if (ledPosition >= 0.6) {
          leds.push("🟡");
        } else {
          leds.push("🟢");
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
   * V3: Format shift data for console output with RPM peak information
   */
  public formatForConsole(shift: ShiftData): string {
    const progressiveStr = shift.progressive.join("");
    const blinkIndicator = shift.blink ? " (BLINK)" : "";

    if (shift.state === "OPTIMAL" && shift.rpmAfterShift !== null) {
      return `${progressiveStr} | ${shift.state} | rpm: ${shift.rpm}→${Math.round(shift.rpmAfterShift)}${blinkIndicator}`;
    } else if (shift.state === "EARLY" && shift.rpmDrop !== null) {
      return `${progressiveStr} | ${shift.state} | rpmDrop: ${Math.round(shift.rpmDrop)}${blinkIndicator}`;
    } else {
      return `${progressiveStr} | ${shift.state} | rpm: ${shift.rpm}${blinkIndicator}`;
    }
  }
}
