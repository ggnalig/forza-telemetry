// Gear-Aware Shift System V3 for Forza Motorsport Telemetry
// TRULY gear-ratio-based shifting with CORRECTED LED visualization

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

    // V3: CORRECTED - TRULY gear-aware progressive LED visualization
    const progressive = this.generateProgressiveLedsV3_CORRECTED(
      rpm,
      maxRpm,
      rpmAfterShift,
      state,
      blink,
      gear,
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
   * V3: CORRECTED - Calculate shift quality metrics based on gear ratios
   */
  private calculateShiftQualityMetrics(
    currentRpm: number,
    rpmAfterShift: number,
    maxRpm: number,
    currentGear: number,
  ): {
    rpmRatio: number;
    shiftQuality: number;
    powerBandQuality: number;
    gearRatioFactor: number;
  } {
    // Basic RPM ratio
    const rpmRatio = currentRpm / maxRpm;

    // Calculate how good the shift is based on RPM after shift
    const idealRpmAfter = maxRpm * 0.75; // Ideal: 75% of max RPM
    const minRpmAfter = this.MIN_POWER_BAND_RPM; // Minimum: 3500 RPM
    const maxRpmAfter = maxRpm * 0.85; // Maximum: 85% of max RPM

    // Shift quality based on RPM after shift
    let shiftQuality = 0;
    if (rpmAfterShift >= minRpmAfter && rpmAfterShift <= maxRpmAfter) {
      // Perfect shift window
      const distanceFromIdeal = Math.abs(rpmAfterShift - idealRpmAfter);
      const maxDistance = Math.max(
        Math.abs(maxRpmAfter - idealRpmAfter),
        Math.abs(minRpmAfter - idealRpmAfter),
      );
      shiftQuality = 1 - distanceFromIdeal / maxDistance;
    } else if (rpmAfterShift < minRpmAfter) {
      // Too low - would drop out of power band
      shiftQuality = rpmAfterShift / minRpmAfter; // Lower is worse
    } else {
      // Too high - approaching limit
      shiftQuality = (maxRpm - rpmAfterShift) / (maxRpm - maxRpmAfter);
    }

    // Power band quality (how well we stay in the power band)
    const powerBandQuality = Math.min(1, rpmAfterShift / (maxRpm * 0.8));

    // Gear ratio factor (higher gears should shift earlier)
    const gearRatioFactor = Math.min(1, currentGear / 6); // Normalize to 0-1

    return {
      rpmRatio,
      shiftQuality: Math.max(0, Math.min(1, shiftQuality)),
      powerBandQuality: Math.max(0, Math.min(1, powerBandQuality)),
      gearRatioFactor,
    };
  }

  /**
   * V3: CORRECTED - Generate TRULY gear-aware progressive LED array
   * Colors based on shift quality metrics calculated from gear ratios
   */
  private generateProgressiveLedsV3_CORRECTED(
    currentRpm: number,
    maxRpm: number,
    rpmAfterShift: number,
    state: string,
    blink: boolean,
    currentGear: number,
  ): string[] {
    // Calculate TRULY gear-aware quality metrics
    const qualityMetrics = this.calculateShiftQualityMetrics(
      currentRpm,
      rpmAfterShift,
      maxRpm,
      currentGear,
    );

    const { rpmRatio, shiftQuality, powerBandQuality } = qualityMetrics;

    // Use exponential bias for realistic progression
    const biasedRatio = Math.pow(rpmRatio, 1.5);
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
        // V3: TRULY gear-aware - based on shift quality, NOT hardcoded ratios
        const qualityThreshold = this.calculateQualityThresholds(
          shiftQuality,
          powerBandQuality,
          ledPosition,
        );

        if (qualityThreshold >= 0.8) {
          leds.push("🔵"); // Blue for excellent shift quality
        } else if (qualityThreshold >= 0.5) {
          leds.push("🟡"); // Yellow for good shift quality
        } else {
          leds.push("🟢"); // Green for building up
        }
      } else if (state === "EARLY") {
        // V3: EARLY state - based on how close to power band (TRULY gear-aware)
        const approachQuality = this.calculateApproachQuality(
          rpmAfterShift,
          ledPosition,
          currentGear,
        );

        if (approachQuality >= 0.6) {
          leds.push("🟡"); // Yellow for approaching power band
        } else {
          leds.push("🟢"); // Green for early/low RPM
        }
      } else {
        // Default progression based on RPM ratio only
        if (ledPosition >= 0.8) {
          leds.push("🔴");
        } else if (ledPosition >= 0.5) {
          leds.push("🟡");
        } else {
          leds.push("🟢");
        }
      }
    }

    return leds;
  }

  /**
   * V3: Calculate quality thresholds for LED colors (TRULY gear-aware)
   */
  private calculateQualityThresholds(
    shiftQuality: number,
    powerBandQuality: number,
    ledPosition: number,
  ): number {
    // Combine shift quality and power band quality
    const combinedQuality = shiftQuality * 0.7 + powerBandQuality * 0.3;

    // Adjust based on LED position (higher LEDs = higher quality required)
    const positionMultiplier = 0.5 + ledPosition * 0.5;

    return combinedQuality * positionMultiplier;
  }

  /**
   * V3: Calculate approach quality for EARLY state (TRULY gear-aware)
   */
  private calculateApproachQuality(
    rpmAfterShift: number,
    ledPosition: number,
    currentGear: number,
  ): number {
    // How close we are to the minimum power band
    const minPowerBand = this.MIN_POWER_BAND_RPM;
    const approachRatio = Math.min(1, rpmAfterShift / minPowerBand);

    // Higher gears should show approach earlier
    const gearFactor = currentGear / 6; // Normalize to 0-1

    // Combine approach ratio with gear factor and LED position
    return approachRatio * 0.7 + gearFactor * 0.2 + ledPosition * 0.1;
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
