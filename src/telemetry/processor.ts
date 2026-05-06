// Telemetry Processor for Car Dash 331-byte format
// Data transformation and validation layer for structured telemetry

import {
  TelemetryData,
  ParsedTelemetryData,
  ProcessedTelemetryData,
} from "../types/telemetry";
import { PhysicsValidator } from "./physics-validator";
import { GearEfficiencyMapGenerator } from "../services/gear-efficiency-map-generator";
import { ShiftEngine } from "../services/shift-engine";

export class TelemetryProcessor {
  private physicsValidator: PhysicsValidator;
  private efficiencyMapGenerator: GearEfficiencyMapGenerator;
  private shiftEngine: ShiftEngine;

  constructor(debugMode = false) {
    this.physicsValidator = new PhysicsValidator(debugMode);
    this.efficiencyMapGenerator = new GearEfficiencyMapGenerator();
    this.shiftEngine = new ShiftEngine();
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

    // Calculate hybrid shift recommendations using new ShiftEngine
    const hybridShiftData = this.shiftEngine.update(
      transformedData.input.gear,
      transformedData.engine.rpm,
      transformedData.performance.speedKmh,
      efficiencyResult.efficiencyMap[transformedData.input.gear]?.rpmOptimal ||
        0,
      this.efficiencyMapGenerator.getSampleCount(transformedData.input.gear) ||
        0,
      transformedData.input.throttle,
    );

    return {
      raw: rawData.raw,
      parsed: transformedData,
      timestamp: Date.now(),
      efficiency: {
        map: efficiencyResult.efficiencyMap,
        recommendations: {
          upshiftRecommended: hybridShiftData.recommendation === "upshift",
          downshiftRecommended: hybridShiftData.recommendation === "downshift",
        },
        lights: hybridShiftData.lights || [],
        currentRpm: transformedData.engine.rpm,
        finalShiftRPM: hybridShiftData.finalShiftRPM,
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

    if (avgTireWear > 0.9) {
      // Unrealistic tire wear
      validatedData.wheels.tireWear.frontLeft = Math.min(
        0.9,
        data.wheels.tireWear.frontLeft,
      );
      validatedData.wheels.tireWear.frontRight = Math.min(
        0.9,
        data.wheels.tireWear.frontRight,
      );
      validatedData.wheels.tireWear.rearLeft = Math.min(
        0.9,
        data.wheels.tireWear.rearLeft,
      );
      validatedData.wheels.tireWear.rearRight = Math.min(
        0.9,
        data.wheels.tireWear.rearRight,
      );
    }

    // Validate suspension travel
    const maxSuspensionTravel = 0.5; // 50cm max
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
   * Transform telemetry data
   */
  private transformTelemetryData(data: TelemetryData): TelemetryData {
    let transformedData = { ...data };

    // Ensure fuel is percentage (0-100)
    transformedData.performance.fuel = data.performance.fuel * 100;

    // Clamp values to realistic ranges
    transformedData.performance.speedKmh = Math.max(
      0,
      Math.min(500, transformedData.performance.speedKmh),
    );
    transformedData.performance.powerKw = Math.max(
      0,
      Math.min(1500, transformedData.performance.powerKw),
    );
    transformedData.performance.fuel = Math.max(
      0,
      Math.min(100, transformedData.performance.fuel),
    );

    return transformedData;
  }
}
