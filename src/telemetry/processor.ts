// Telemetry Processor for Car Dash 331-byte format
// Data transformation and validation layer for structured telemetry

import {
  TelemetryData,
  ParsedTelemetryData,
  ProcessedTelemetryData,
} from "../types/telemetry";
import { PhysicsValidator } from "./physics-validator";
import { GearEfficiencyMapGenerator } from "../services/gear-efficiency-map-generator";

export class TelemetryProcessor {
  private lastProcessedTelemetry: TelemetryData | null = null;
  private physicsValidator: PhysicsValidator;
  private efficiencyMapGenerator: GearEfficiencyMapGenerator;

  constructor(debugMode = false) {
    this.physicsValidator = new PhysicsValidator(debugMode);
    this.efficiencyMapGenerator = new GearEfficiencyMapGenerator();
  }

  /**
   * Process and transform telemetry data
   * Validates data consistency and applies transformations
   */
  public process(rawData: ParsedTelemetryData): ProcessedTelemetryData {
    const telemetry = rawData.parsed;

    // Apply physics validation and normalization
    const physicsValidation =
      this.physicsValidator.validatePhysicsData(telemetry);

    // Update telemetry with validated physics data
    const validatedTelemetry = {
      ...telemetry,
      performance: {
        ...telemetry.performance,
        torqueNm: physicsValidation.torque,
        powerKw: physicsValidation.power,
      },
    };

    // Validate data consistency
    const validatedData = this.validateTelemetryConsistency(validatedTelemetry);

    // Apply transformations
    const transformedData = this.transformTelemetryData(validatedData);

    // Update efficiency map with current telemetry
    const efficiencyResult = this.efficiencyMapGenerator.update({
      gear: transformedData.input.gear,
      rpm: transformedData.engine.rpm,
      speed: transformedData.performance.speedKmh,
      torque: transformedData.performance.torqueNm,
    });

    // Store for next validation
    this.lastProcessedTelemetry = transformedData;

    return {
      raw: rawData.raw,
      parsed: transformedData,
      timestamp: Date.now(),
      efficiency: {
        map: efficiencyResult.efficiencyMap,
        recommendations: efficiencyResult.shiftRecommendations,
      },
    };
  }

  /**
   * Validate telemetry data consistency
   */
  private validateTelemetryConsistency(data: TelemetryData): TelemetryData {
    // Check for logical inconsistencies
    let validatedData = { ...data };

    // Validate speed vs RPM relationship
    if (
      data.performance.speedKmh > 0 &&
      data.engine.rpm < data.engine.idleRpm
    ) {
      // Engine should be running if car is moving
      validatedData.engine.rpm = Math.max(data.engine.idleRpm, data.engine.rpm);
    }

    // Validate gear vs speed relationship
    if (data.input.gear === 0 && data.performance.speedKmh > 5) {
      // Car shouldn't be moving fast in neutral
      validatedData.performance.speedKmh = Math.min(
        5,
        data.performance.speedKmh,
      );
    }

    // Validate throttle vs brake relationship
    if (data.input.throttle > 0.8 && data.input.brake > 0.8) {
      // Both pedals shouldn't be pressed hard simultaneously
      validatedData.input.brake = Math.min(0.5, data.input.brake);
    }

    // Validate tire temperature consistency
    const avgTireTemp =
      (data.wheels.tireTemp.frontLeft +
        data.wheels.tireTemp.frontRight +
        data.wheels.tireTemp.rearLeft +
        data.wheels.tireTemp.rearRight) /
      4;

    if (avgTireTemp > 150) {
      // Unrealistic tire temperatures
      validatedData.wheels.tireTemp.frontLeft = Math.min(
        150,
        data.wheels.tireTemp.frontLeft,
      );
      validatedData.wheels.tireTemp.frontRight = Math.min(
        150,
        data.wheels.tireTemp.frontRight,
      );
      validatedData.wheels.tireTemp.rearLeft = Math.min(
        150,
        data.wheels.tireTemp.rearLeft,
      );
      validatedData.wheels.tireTemp.rearRight = Math.min(
        150,
        data.wheels.tireTemp.rearRight,
      );
    }

    // Validate tire wear consistency
    const avgTireWear =
      (data.wheels.tireWear.frontLeft +
        data.wheels.tireWear.frontRight +
        data.wheels.tireWear.rearLeft +
        data.wheels.tireWear.rearRight) /
      4;

    if (avgTireWear < 0 || avgTireWear > 100) {
      // Tire wear should be between 0-100%
      validatedData.wheels.tireWear.frontLeft = Math.max(
        0,
        Math.min(100, data.wheels.tireWear.frontLeft),
      );
      validatedData.wheels.tireWear.frontRight = Math.max(
        0,
        Math.min(100, data.wheels.tireWear.frontRight),
      );
      validatedData.wheels.tireWear.rearLeft = Math.max(
        0,
        Math.min(100, data.wheels.tireWear.rearLeft),
      );
      validatedData.wheels.tireWear.rearRight = Math.max(
        0,
        Math.min(100, data.wheels.tireWear.rearRight),
      );
    }

    // Validate suspension travel
    const maxSuspensionTravel = 0.5; // 50cm max reasonable travel
    if (data.wheels.suspensionTravel.frontLeft > maxSuspensionTravel) {
      validatedData.wheels.suspensionTravel.frontLeft = maxSuspensionTravel;
    }
    if (data.wheels.suspensionTravel.frontRight > maxSuspensionTravel) {
      validatedData.wheels.suspensionTravel.frontRight = maxSuspensionTravel;
    }
    if (data.wheels.suspensionTravel.rearLeft > maxSuspensionTravel) {
      validatedData.wheels.suspensionTravel.rearLeft = maxSuspensionTravel;
    }
    if (data.wheels.suspensionTravel.rearRight > maxSuspensionTravel) {
      validatedData.wheels.suspensionTravel.rearRight = maxSuspensionTravel;
    }

    return validatedData;
  }

  /**
   * Transform telemetry data for consistency
   */
  private transformTelemetryData(data: TelemetryData): TelemetryData {
    // Apply additional transformations
    let transformedData = { ...data };

    // Smooth lap times if they show unrealistic jumps
    if (this.lastProcessedTelemetry) {
      const lastBestLap = this.lastProcessedTelemetry.lap.best;
      const lastLastLap = this.lastProcessedTelemetry.lap.last;

      // Validate lap time consistency
      if (data.lap.best > 0 && data.lap.best < lastBestLap - 10) {
        // Best lap shouldn't improve by more than 10 seconds suddenly
        transformedData.lap.best = Math.max(data.lap.best, lastBestLap - 1);
      }

      if (data.lap.last > 0 && Math.abs(data.lap.last - lastLastLap) > 60) {
        // Last lap shouldn't change by more than 60 seconds
        transformedData.lap.last = lastLastLap;
      }
    }

    // Ensure race position is reasonable
    if (data.lap.position < 1) {
      transformedData.lap.position = 1;
    } else if (data.lap.position > 24) {
      // Forza typically supports up to 24 cars
      transformedData.lap.position = 24;
    }

    // Normalize AI assistance values
    if (Math.abs(data.ai.normalizedDrivingLine) > 1) {
      transformedData.ai.normalizedDrivingLine = Math.sign(
        data.ai.normalizedDrivingLine,
      );
    }

    if (Math.abs(data.ai.normalizedAIBrakeDifference) > 1) {
      transformedData.ai.normalizedAIBrakeDifference = Math.sign(
        data.ai.normalizedAIBrakeDifference,
      );
    }

    // Ensure fuel is within reasonable bounds
    if (data.performance.fuel < 0 || data.performance.fuel > 100) {
      transformedData.performance.fuel = Math.max(
        0,
        Math.min(100, data.performance.fuel),
      );
    }

    // Ensure boost is non-negative
    if (data.performance.boost < 0) {
      transformedData.performance.boost = 0;
    }

    return transformedData;
  }

  /**
   * Get processing statistics
   */
  public getStats(): {
    lastProcessedTime: number | null;
    isActive: boolean;
  } {
    return {
      lastProcessedTime: this.lastProcessedTelemetry ? Date.now() : null,
      isActive: this.lastProcessedTelemetry !== null,
    };
  }

  /**
   * Reset processor state
   */
  public reset(): void {
    this.lastProcessedTelemetry = null;
  }
}
