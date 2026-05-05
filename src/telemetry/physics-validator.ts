// Physics Data Validator for Forza Motorsport Telemetry
// Implements strict normalization and validation pipeline for torque and power data
// Production-grade telemetry system similar to MoTeC / Haltech dashboards

import { TelemetryData } from "../types/telemetry";
import { TelemetryLogger } from "../utils/logger";

export interface ValidationResult {
  torque: number;
  power: number;
  isValid: boolean;
  validationReason: string;
  debugInfo: {
    rawTorque: number;
    rawPower: number; // Raw power in Watts
    computedPower: number; // Computed power in kW
    validationReason: string;
    isBurnout: boolean;
    isInvalidState: boolean;
    isPowerFallback: boolean;
  };
}

export class PhysicsValidator {
  // Validation constants - UPDATED per new requirements
  private static readonly MIN_POWER_KW = 0;
  private static readonly MAX_POWER_KW = 1500; // Updated from 2000 to 1500 kW
  private static readonly MIN_TORQUE_NM = -100; // Raw torque can be negative (engine braking)
  private static readonly MAX_TORQUE_NM = 3000;
  private static readonly BURNOUT_SPEED_THRESHOLD = 5; // km/h
  private static readonly BURNOUT_INPUT_THRESHOLD = 0.9;
  private static readonly IDLE_SPEED_THRESHOLD = 1; // km/h
  private static readonly PRE_RACE_LAP_NUMBER = 0;

  private debugMode: boolean;
  private logger: TelemetryLogger;

  constructor(debugMode = false) {
    this.debugMode = debugMode;
    this.logger = new TelemetryLogger();
    this.logger.setDebugMode(debugMode);
  }

  /**
   * Main validation pipeline for physics data
   * Implements all critical requirements for production-grade telemetry
   */
  public validatePhysicsData(data: TelemetryData): ValidationResult {
    // CRITICAL: Raw power from telemetry is in WATTS, not kW
    const rawTorque = data.performance.torqueNm;
    const rawPowerWatts = data.performance.powerKw; // This is actually in WATTS
    const rawPowerKw = rawPowerWatts / 1000; // Convert W to kW

    const rpm = data.engine.rpm;
    const idleRpm = data.engine.idleRpm;

    let validatedTorque = rawTorque;
    let validatedPowerKw = rawPowerKw;
    let validationReason = "none";
    let isPowerFallback = false;
    let isBurnout = false;
    let isInvalidState = false;
    let wasOriginalPowerValid = true; // Track if original power was within valid range

    // Step 1: HARD VALIDATION - Check for completely invalid ranges
    const isTorqueOutOfRange = this.isTorqueOutOfRange(rawTorque);
    const isPowerOutOfRange = this.isPowerOutOfRange(rawPowerKw);

    if (isTorqueOutOfRange || isPowerOutOfRange) {
      // Clamp torque to valid range (raw can be negative for engine braking)
      if (isTorqueOutOfRange) {
        validatedTorque = this.clampTorque(rawTorque);
      }

      // Set power to 0 if out of range, but handle negative power specially
      if (isPowerOutOfRange) {
        if (rawPowerKw < 0 && rawTorque > 0) {
          // Negative power with positive torque - use power fallback instead of rejection
          wasOriginalPowerValid = true; // Allow fallback for this case
          validatedPowerKw = 0; // Set to 0 temporarily
          validationReason = "power_fallback"; // Set reason to fallback
        } else {
          // Truly invalid power (too high or negative with no torque)
          validationReason = "power_out_of_range";
          validatedPowerKw = 0;
          wasOriginalPowerValid = false;
        }
      }
    }

    // Step 2: CONTEXT-AWARE FILTERING - Detect invalid driving states
    isInvalidState = this.isInvalidDrivingState(data);

    if (isInvalidState) {
      validationReason = "invalid_driving_state";
      validatedTorque = 0;
      validatedPowerKw = 0;
    }

    // Step 3: BURNOUT DETECTION - Handle burnout conditions
    isBurnout = this.isBurnoutCondition(data);

    if (isBurnout && !isInvalidState) {
      validationReason = "burnout_detected";
      // Clamp torque to >= 0 for UI (engine output normalization)
      validatedTorque = Math.max(0, validatedTorque);

      // Recompute power using clamped torque and current RPM
      if (validatedTorque > 0 && rpm > idleRpm) {
        validatedPowerKw =
          validatedPowerKw ||
          this.calculatePowerFromTorque(validatedTorque, rpm) / 1000;
      } else {
        validatedPowerKw = 0;
      }
    }

    // Step 4: ENGINE OUTPUT NORMALIZATION - Clamp torque >= 0 for UI
    // This is MANDATORY - final torque must never be negative for UI
    if (validatedTorque < 0) {
      validatedTorque = 0;
    }

    // Step 5: POWER FALLBACK - Calculate power from torque and RPM if needed
    const shouldUsePowerFallback = this.shouldUsePowerFallback(
      validatedPowerKw,
      validatedTorque,
      rpm,
      idleRpm,
      wasOriginalPowerValid,
    );

    if (shouldUsePowerFallback) {
      // Only set to power_fallback if no other validation reason was set
      if (validationReason === "none") {
        validationReason = "power_fallback";
      }
      const computedPower = this.calculatePowerFromTorque(validatedTorque, rpm);
      validatedPowerKw = computedPower;
      isPowerFallback = true;
    }

    // Step 6: FINAL VALIDATION - Ensure no negative power reaches UI and realistic limits
    validatedPowerKw = Math.max(0, validatedPowerKw);
    // Clamp to realistic engine limits (0-1500 kW)
    validatedPowerKw = Math.min(1500, validatedPowerKw);

    // Step 7: DEBUG LOGGING - Log validation details if debug mode enabled
    if (this.debugMode) {
      const computedPower = shouldUsePowerFallback
        ? validatedPowerKw
        : this.calculatePowerFromTorque(validatedTorque, rpm);

      console.log("🔧 Physics Validation Debug:");
      console.log(`  Raw Torque: ${rawTorque} Nm`);
      console.log(
        `  Raw Power: ${rawPowerWatts} W (${rawPowerKw.toFixed(2)} kW)`,
      );
      console.log(`  Computed Power: ${computedPower.toFixed(2)} kW`);
      console.log(`  Validation Reason: ${validationReason}`);
      console.log(`  Is Burnout: ${isBurnout}`);
      console.log(`  Is Invalid State: ${isInvalidState}`);
      console.log(`  Is Power Fallback: ${isPowerFallback}`);
      console.log(`  Final Torque: ${validatedTorque} Nm`);
      console.log(`  Final Power: ${validatedPowerKw.toFixed(2)} kW`);
      console.log("");
    }

    return {
      torque: validatedTorque,
      power: validatedPowerKw,
      isValid:
        validationReason === "none" || validationReason === "power_fallback",
      validationReason,
      debugInfo: {
        rawTorque,
        rawPower: rawPowerWatts, // Store raw power in Watts for debug
        computedPower: isPowerFallback
          ? validatedPowerKw
          : this.calculatePowerFromTorque(validatedTorque, rpm),
        validationReason,
        isBurnout,
        isInvalidState,
        isPowerFallback,
      },
    };
  }

  /**
   * Check if torque is outside valid range
   */
  private isTorqueOutOfRange(torque: number): boolean {
    return (
      torque < PhysicsValidator.MIN_TORQUE_NM ||
      torque > PhysicsValidator.MAX_TORQUE_NM
    );
  }

  /**
   * Check if power is outside valid range
   */
  private isPowerOutOfRange(power: number): boolean {
    return (
      power < PhysicsValidator.MIN_POWER_KW ||
      power > PhysicsValidator.MAX_POWER_KW
    );
  }

  /**
   * Clamp torque to valid range
   */
  private clampTorque(torque: number): number {
    return Math.max(
      PhysicsValidator.MIN_TORQUE_NM,
      Math.min(PhysicsValidator.MAX_TORQUE_NM, torque),
    );
  }

  /**
   * Detect invalid driving states
   */
  private isInvalidDrivingState(data: TelemetryData): boolean {
    const speed = data.performance.speedKmh;
    const lapNumber = data.lap.number;
    const throttle = data.input.throttle;
    const brake = data.input.brake;
    const isRaceOn = data.isRaceOn === 1;

    // CRITICAL: RPM <= idle RPM (not just speed < 1)
    if (data.engine.rpm <= data.engine.idleRpm) {
      return true;
    }

    if (speed < PhysicsValidator.IDLE_SPEED_THRESHOLD) {
      return true;
    }

    if (lapNumber === PhysicsValidator.PRE_RACE_LAP_NUMBER) {
      return true;
    }

    // No input state (coasting with no throttle or brake)
    if (throttle === 0 && brake === 0 && speed < 10) {
      return true;
    }

    // Pre-race countdown (race not started)
    if (!isRaceOn) {
      return true;
    }

    return false;
  }

  /**
   * Detect burnout conditions
   */
  private isBurnoutCondition(data: TelemetryData): boolean {
    const throttle = data.input.throttle;
    const brake = data.input.brake;
    const speed = data.performance.speedKmh;

    return (
      throttle > PhysicsValidator.BURNOUT_INPUT_THRESHOLD &&
      brake > PhysicsValidator.BURNOUT_INPUT_THRESHOLD &&
      speed < PhysicsValidator.BURNOUT_SPEED_THRESHOLD
    );
  }

  /**
   * Determine if power should be calculated from torque and RPM
   * ONLY use fallback if original power was valid but zero/negative with positive torque
   */
  private shouldUsePowerFallback(
    power: number,
    torque: number,
    rpm: number,
    idleRpm: number,
    wasOriginalPowerValid: boolean,
  ): boolean {
    // If original power was invalid (out of range), don't use fallback
    if (!wasOriginalPowerValid) {
      return false;
    }

    // Power is zero but we have positive torque and RPM above idle (original power was likely valid)
    if (power === 0 && torque > 0 && rpm > idleRpm) {
      return true;
    }

    // Power is negative but torque is positive (physics calculation error)
    if (power < 0 && torque > 0) {
      return true;
    }

    return false;
  }

  /**
   * Calculate power from torque and RPM using physics formula
   * P = torque × angularVelocity
   * Where angularVelocity = RPM × 2π / 60
   * Returns power in kW
   */
  private calculatePowerFromTorque(torque: number, rpm: number): number {
    if (torque <= 0 || rpm <= 0) {
      return 0;
    }

    // P (kW) = torque (Nm) × angular velocity (rad/s) / 1000
    const angularVelocity = (rpm * 2 * Math.PI) / 60; // rad/s
    const powerWatts = torque * angularVelocity; // Watts
    const powerKw = powerWatts / 1000; // Convert to kW

    return Math.max(0, powerKw);
  }

  /**
   * Enable or disable debug mode
   */
  public setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }
}
