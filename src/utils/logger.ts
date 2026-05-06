// Debug logger for Car Dash 331-byte telemetry system
// Rate-limited logging with comprehensive telemetry snapshots

import { TelemetryData, ShiftData } from "../types/telemetry";

export class TelemetryLogger {
  private lastLogTime = 0;
  private readonly LOG_INTERVAL = 500; // 500ms rate limit
  private debugMode = false;

  /**
   * Log telemetry snapshot (mandatory every 500ms)
   */
  public logTelemetry(data: TelemetryData): void {
    // Rate limiting
    const now = Date.now();
    if (now - this.lastLogTime < this.LOG_INTERVAL) {
      return;
    }

    // Telemetry Snapshot format (as specified) with new structured data
    const snapshot = `Telemetry Snapshot -->: Speed: ${Math.round(data.performance.speedKmh)} km/h, RPM: ${Math.round(data.engine.rpm)}, Gear: ${data.input.gear}, Throttle: ${Math.round(data.input.throttle * 100)} %, Brake: ${Math.round(data.input.brake * 100)} %, Torque: ${Math.round(data.performance.torqueNm)} Nm, Power: ${Math.round(data.performance.powerKw)} kW, Boost: ${data.performance.boost.toFixed(1)} bar, Fuel: ${data.performance.fuel.toFixed(1)} %, Lap: ${data.lap.number}`;

    console.log(snapshot);
    this.lastLogTime = now;
  }

  /**
   * Log shift light data with GT-style visualization
   */
  public logShiftData(shiftData: ShiftData): void {
    if (!this.debugMode) return;

    const progressiveStr = shiftData.progressive.join("");
    const blinkIndicator = shiftData.blink ? " (BLINK)" : "";

    console.log("🚦 GEAR-AWARE SHIFT SYSTEM V3:");
    console.log(`  Progressive: ${progressiveStr}${blinkIndicator}`);
    console.log(`  State: ${shiftData.state} | Light: ${shiftData.light}`);

    if (shiftData.rpmAfterShift !== null) {
      console.log(
        `  RPM: ${shiftData.rpm} → After Shift: ${Math.round(shiftData.rpmAfterShift)} | Optimal: ${shiftData.optimal}`,
      );
    } else {
      console.log(`  RPM: ${shiftData.rpm} | Optimal: ${shiftData.optimal}`);
    }

    console.log(`  Reason: ${shiftData.reason} | Mode: ${shiftData.mode}`);

    if (shiftData.debug) {
      if (shiftData.debug.currentGear !== undefined) {
        console.log(
          `  Debug: Gear ${shiftData.debug.currentGear} → ${shiftData.debug.nextGear}, Ratio: ${shiftData.debug.currentRatio?.toFixed(2)} → ${shiftData.debug.nextRatio?.toFixed(2)}`,
        );
      } else if (shiftData.debug.rpm !== undefined) {
        console.log(`  Debug: RPM=${shiftData.debug.rpm}`);
      }
    }

    console.log("");
  }

  /**
   * Log debug information with raw values
   */
  public logDebug(
    rawSpeed: number,
    speedSource: string,
    velocityComponents?: { vx: number; vy: number; vz: number },
    computedSpeed?: number,
  ): void {
    if (!this.debugMode) return;

    console.log("🔍 DEBUG TELEMETRY DATA:");
    console.log(`  Raw Speed: ${rawSpeed.toFixed(2)} m/s`);
    console.log(`  Speed Source: ${speedSource}`);

    if (velocityComponents) {
      const { vx, vy, vz } = velocityComponents;
      console.log(
        `  Velocity Components: vx=${vx.toFixed(2)}, vy=${vy.toFixed(2)}, vz=${vz.toFixed(2)} m/s`,
      );
    }

    if (computedSpeed !== undefined) {
      console.log(`  Computed Speed: ${computedSpeed.toFixed(2)} m/s`);
    }

    console.log("");
  }

  /**
   * Log validation errors
   */
  public logError(message: string, details?: any): void {
    console.error(`❌ TELEMETRY ERROR: ${message}`);
    if (details) {
      console.error("  Details:", details);
    }
  }

  /**
   * Log warnings
   */
  public logWarning(message: string, details?: any): void {
    console.warn(`⚠️  TELEMETRY WARNING: ${message}`);
    if (details) {
      console.warn("  Details:", details);
    }
  }

  /**
   * Log info messages
   */
  public logInfo(message: string): void {
    console.log(`ℹ️  TELEMETRY INFO: ${message}`);
  }

  /**
   * Enable/disable debug mode
   */
  public setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    console.log(`Debug mode ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Reset logger state
   */
  public reset(): void {
    this.lastLogTime = 0;
  }
}
