// Advanced Shift Light System V2 for Forza Motorsport Telemetry
// Professional-grade shift indicator with GT-style progressive LEDs, hysteresis, and anti-flicker

import { TelemetryData } from "../types/telemetry";

export interface ShiftData {
  state: "OFF" | "EARLY" | "BUILDING" | "OPTIMAL" | "LATE";
  light: "⚫" | "🟢" | "🟡" | "🔵" | "🔴";
  rpmRatio: number;
  optimal: boolean;
  reason: string;
  mode: "RPM" | "POWER";
  blink: boolean;
  progressive: string[];
  debug?: {
    rpm: number;
    rpmRatio: number;
    thresholds: object;
  };
}

export class ShiftService {
  private readonly PROGRESSIVE_STEPS = 6;
  private readonly THROTTLE_THRESHOLD = 0.2;

  // V2: Improved thresholds for human reaction time
  private readonly EARLY_THRESHOLD = 0.7; // < 0.7 → EARLY
  private readonly BUILDING_THRESHOLD = 0.88; // 0.7-0.88 → BUILDING
  private readonly OPTIMAL_THRESHOLD = 0.95; // 0.88-0.95 → OPTIMAL
  private readonly LATE_THRESHOLD = 0.95; // ≥ 0.95 → LATE
  private readonly BLINK_THRESHOLD = 0.98; // ≥ 0.98 → BLINK

  // V2: Hysteresis thresholds to prevent flickering
  private readonly SHIFT_UP_THRESHOLD = 0.9; // Enter OPTIMAL
  private readonly SHIFT_DOWN_THRESHOLD = 0.85; // Exit OPTIMAL

  // V2: LED color zones with dedicated OPTIMAL zone (🔵)
  private readonly GREEN_ZONE = 0.6; // < 0.6 → 🟢
  private readonly YELLOW_ZONE = 0.85; // 0.6-0.85 → 🟡
  private readonly OPTIMAL_ZONE = 0.95; // 0.85-0.95 → 🔵

  private readonly BLINK_INTERVAL = 150; // ms

  private lastShiftState: ShiftData | null = null;

  /**
   * Calculate advanced shift indicators with hysteresis and anti-flicker
   */
  public calculateShift(
    telemetry: TelemetryData,
    prevState?: ShiftData,
  ): ShiftData {
    const { engine, input } = telemetry;
    const { rpm, maxRpm } = engine;
    const { throttle, gear } = input;

    // Use previous state if provided, otherwise use stored state
    const previousState = prevState || this.lastShiftState;

    // Edge case handling
    if (gear === 0 || maxRpm <= 0 || isNaN(rpm) || isNaN(maxRpm)) {
      return this.getOffState("GEAR_0_OR_INVALID");
    }

    if (throttle < this.THROTTLE_THRESHOLD) {
      return this.getOffState("THROTTLE_OFF");
    }

    const rpmRatio = rpm / maxRpm;

    // V2: Determine state with hysteresis
    const state = this.determineShiftStateWithHysteresis(
      rpmRatio,
      previousState,
    );
    const blink = this.shouldBlink(rpmRatio, telemetry.timestamp);

    // V2: Non-linear progressive LED with exponential bias
    const progressive = this.generateProgressiveLedsV2(rpmRatio, blink);

    // V2: State ↔ LED synchronization (prevent mismatches)
    const synchronizedState = this.synchronizeStateWithLEDs(state, progressive);

    const shiftData: ShiftData = {
      state: synchronizedState,
      light: this.mapStateToLight(synchronizedState),
      rpmRatio,
      optimal: synchronizedState === "OPTIMAL",
      reason: this.getReason(synchronizedState),
      mode: "RPM",
      blink,
      progressive,
      debug: {
        rpm,
        rpmRatio,
        thresholds: {
          early: this.EARLY_THRESHOLD,
          building: this.BUILDING_THRESHOLD,
          optimal: this.OPTIMAL_THRESHOLD,
          late: this.LATE_THRESHOLD,
          shiftUp: this.SHIFT_UP_THRESHOLD,
          shiftDown: this.SHIFT_DOWN_THRESHOLD,
        },
      },
    };

    // Store for next iteration
    this.lastShiftState = shiftData;

    return shiftData;
  }

  /**
   * V2: Determine shift state with hysteresis to prevent flickering
   */
  private determineShiftStateWithHysteresis(
    rpmRatio: number,
    previousState: ShiftData | null,
  ): "OFF" | "EARLY" | "BUILDING" | "OPTIMAL" | "LATE" {
    if (rpmRatio < this.EARLY_THRESHOLD) {
      return "EARLY";
    } else if (rpmRatio < this.BUILDING_THRESHOLD) {
      return "BUILDING";
    } else if (rpmRatio < this.SHIFT_UP_THRESHOLD) {
      return "BUILDING";
    } else if (rpmRatio < this.OPTIMAL_THRESHOLD) {
      // V2: Hysteresis logic for OPTIMAL state
      if (previousState?.state === "OPTIMAL") {
        // Stay OPTIMAL until RPM drops below shift down threshold
        return rpmRatio >= this.SHIFT_DOWN_THRESHOLD ? "OPTIMAL" : "BUILDING";
      } else {
        // Enter OPTIMAL only when crossing shift up threshold
        return "OPTIMAL";
      }
    } else {
      return "LATE";
    }
  }

  /**
   * V2: Map shift state to emoji light with 🔵 blue for OPTIMAL
   */
  private mapStateToLight(
    state: "OFF" | "EARLY" | "BUILDING" | "OPTIMAL" | "LATE",
  ): "⚫" | "🟢" | "🟡" | "🔵" | "🔴" {
    switch (state) {
      case "OFF":
        return "⚫";
      case "EARLY":
        return "🟢";
      case "BUILDING":
        return "🟡";
      case "OPTIMAL":
        return "🔵";
      case "LATE":
        return "🔴";
      default:
        return "⚫";
    }
  }

  /**
   * V2: Get reason for current shift state
   */
  private getReason(state: string): string {
    switch (state) {
      case "OFF":
        return "THROTTLE_OFF";
      case "EARLY":
        return "LOW_RPM";
      case "BUILDING":
        return "BUILDING_POWER";
      case "OPTIMAL":
        return "SHIFT_WINDOW";
      case "LATE":
        return "OVER_REV";
      default:
        return "UNKNOWN";
    }
  }

  /**
   * V2: Determine if LED should blink (rev limiter) with timestamp
   */
  private shouldBlink(rpmRatio: number, timestamp: number): boolean {
    if (rpmRatio >= this.BLINK_THRESHOLD) {
      return Math.floor(timestamp / this.BLINK_INTERVAL) % 2 === 0;
    }
    return false;
  }

  /**
   * V2: Generate non-linear progressive LED array with exponential bias
   */
  private generateProgressiveLedsV2(
    rpmRatio: number,
    blink: boolean,
  ): string[] {
    // V2: Non-linear bias using exponential function
    const biasedRatio = Math.pow(rpmRatio, 1.5);
    const activeLeds = Math.floor(biasedRatio * this.PROGRESSIVE_STEPS);
    const leds: string[] = [];

    for (let i = 0; i < this.PROGRESSIVE_STEPS; i++) {
      const ledRatio = (i + 1) / this.PROGRESSIVE_STEPS;

      if (i >= activeLeds) {
        // LED is off
        leds.push("⚫");
      } else if (blink && rpmRatio >= this.BLINK_THRESHOLD) {
        // Blinking red for rev limiter
        leds.push("🔴");
      } else if (ledRatio <= this.GREEN_ZONE) {
        // V2: Green zone
        leds.push("🟢");
      } else if (ledRatio <= this.YELLOW_ZONE) {
        // V2: Yellow zone
        leds.push("🟡");
      } else if (ledRatio <= this.OPTIMAL_ZONE) {
        // V2: OPTIMAL zone with 🔵 blue
        leds.push("🔵");
      } else {
        // V2: Red zone - ensure red for high RPM
        leds.push("🔴");
      }
    }

    return leds;
  }

  /**
   * V2: Synchronize state with LED display to prevent mismatches
   */
  private synchronizeStateWithLEDs(
    state: "OFF" | "EARLY" | "BUILDING" | "OPTIMAL" | "LATE",
    progressive: string[],
  ): "OFF" | "EARLY" | "BUILDING" | "OPTIMAL" | "LATE" {
    // Find last active LED
    const lastActiveIndex = progressive.findIndex((led) => led !== "⚫");
    const lastActiveLED =
      lastActiveIndex >= 0 ? progressive[lastActiveIndex] : "⚫";

    // V2: Rule - if last active LED is 🔴, force state to LATE
    if (lastActiveLED === "🔴" && state !== "LATE") {
      return "LATE";
    }

    return state;
  }

  /**
   * V2: Get off state (no shifting needed)
   */
  private getOffState(reason: string): ShiftData {
    return {
      state: "OFF",
      light: "⚫",
      rpmRatio: 0,
      optimal: false,
      reason,
      mode: "RPM",
      blink: false,
      progressive: ["⚫", "⚫", "⚫", "⚫", "⚫", "⚫"],
    };
  }

  /**
   * V2: Format shift data for console output
   */
  public formatForConsole(shift: ShiftData): string {
    const progressiveStr = shift.progressive.join("");
    const blinkIndicator = shift.blink ? " (BLINK)" : "";
    return `${progressiveStr} | ${shift.state} | ${shift.rpmRatio.toFixed(2)}${blinkIndicator}`;
  }
}
