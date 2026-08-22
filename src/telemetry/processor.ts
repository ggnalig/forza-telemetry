// Telemetry Processor for Car Dash 331-byte format
// Data transformation and validation layer for structured telemetry

import {
  TelemetryData,
  ParsedTelemetryData,
  ProcessedTelemetryData,
} from "../types/telemetry";
import { PhysicsValidator } from "./physics-validator";
import { GearEfficiencyMapGenerator } from "../services/gear-efficiency-map-generator";
import { GearRatioEstimator } from "../services/gear-ratio-estimator";
import { EnginePowerCurve } from "../services/engine-power-curve";
import { ShiftEngine, MAX_SUPPORTED_GEAR } from "../services/shift-engine";
import {
  CarProfileStore,
  CarProfile,
  CarMeta,
} from "../services/car-profile-store";

export class TelemetryProcessor {
  private physicsValidator: PhysicsValidator;
  private efficiencyMapGenerator: GearEfficiencyMapGenerator;
  private gearRatioEstimator: GearRatioEstimator;
  private enginePowerCurve: EnginePowerCurve;
  private shiftEngine: ShiftEngine;
  private carProfileStore: CarProfileStore;
  private lastCarOrdinal: number | null = null;
  private lastCarMeta: CarMeta | null = null;

  constructor(debugMode = false, carProfileStore: CarProfileStore = new CarProfileStore()) {
    this.physicsValidator = new PhysicsValidator(debugMode);
    this.efficiencyMapGenerator = new GearEfficiencyMapGenerator();
    this.gearRatioEstimator = new GearRatioEstimator();
    this.enginePowerCurve = new EnginePowerCurve();
    this.shiftEngine = new ShiftEngine();
    this.carProfileStore = carProfileStore;
  }

  /**
   * Every car in Forza has its own gearing/power characteristics - learned
   * state from a previous car must not bleed into predictions for a new one.
   * The outgoing car's state is saved to disk first so it can warm-start next
   * time it's driven; the incoming car's saved profile (if any) is loaded.
   */
  private handleCarChange(telemetry: TelemetryData): void {
    const carOrdinal = telemetry.car.ordinal;

    if (this.lastCarOrdinal !== null && this.lastCarOrdinal !== carOrdinal) {
      if (this.lastCarMeta) {
        this.carProfileStore.save(this.exportCarProfile(this.lastCarMeta));
      }

      this.efficiencyMapGenerator.reset();
      this.gearRatioEstimator.reset();
      this.enginePowerCurve.reset();
      this.shiftEngine.reset();

      const savedProfile = this.carProfileStore.load(carOrdinal);
      if (savedProfile) {
        this.importCarProfile(savedProfile);
      }
    }

    this.lastCarOrdinal = carOrdinal;
    this.lastCarMeta = {
      carOrdinal,
      carClass: telemetry.car.class,
      performanceIndex: telemetry.car.performanceIndex,
      drivetrain: telemetry.car.drivetrain,
      numCylinders: telemetry.engine.cylinders,
      idleRpm: telemetry.engine.idleRpm,
      maxRpm: telemetry.engine.maxRpm,
    };
  }

  private exportCarProfile(meta: CarMeta): CarProfile {
    return {
      meta,
      gearRatios: this.gearRatioEstimator.exportState(),
      gearEfficiency: this.efficiencyMapGenerator.exportState(),
      powerCurve: this.enginePowerCurve.exportState(),
      shiftHistory: this.shiftEngine.exportState(),
    };
  }

  private importCarProfile(profile: CarProfile): void {
    this.gearRatioEstimator.importState(profile.gearRatios);
    this.efficiencyMapGenerator.importState(profile.gearEfficiency);
    this.enginePowerCurve.importState(profile.powerCurve);
    this.shiftEngine.importState(profile.shiftHistory);
  }

  /**
   * Persists the currently-active car's learned state. Call this on graceful
   * shutdown so progress isn't lost if the process exits without a car change.
   */
  public persistCurrentCarProfile(): void {
    if (this.lastCarMeta) {
      this.carProfileStore.save(this.exportCarProfile(this.lastCarMeta));
    }
  }

  /**
   * Process and transform telemetry data
   * Validates data consistency and applies transformations
   */
  public process(rawData: ParsedTelemetryData): ProcessedTelemetryData {
    const telemetry = rawData.parsed;

    this.handleCarChange(telemetry);

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

    // Feed the empirical gear ratio estimator so cross-gear rpm drop can be
    // computed without a hardcoded per-car config.
    this.gearRatioEstimator.update(
      transformedData.input.gear,
      transformedData.engine.rpm,
      transformedData.performance.speedKmh,
    );

    // Feed the pooled (gear-independent) WOT power curve used for the
    // cross-gear optimal shift point calculation.
    this.enginePowerCurve.update(
      transformedData.engine.rpm,
      transformedData.performance.powerKw,
      transformedData.input.throttle,
      transformedData.engine.maxRpm,
    );

    // Update efficiency map with current telemetry
    const efficiencyResult = this.efficiencyMapGenerator.update({
      gear: transformedData.input.gear,
      rpm: transformedData.engine.rpm,
      power: transformedData.performance.powerKw,
      throttle: transformedData.input.throttle,
      maxRpm: transformedData.engine.maxRpm,
    });

    // Calculate hybrid shift recommendations using new ShiftEngine
    const hybridShiftData = this.shiftEngine.update({
      gear: transformedData.input.gear,
      rpm: transformedData.engine.rpm,
      speed: transformedData.performance.speedKmh,
      maxRpm: transformedData.engine.maxRpm,
      idleRpm: transformedData.engine.idleRpm,
      rpmOptimal:
        efficiencyResult.efficiencyMap[transformedData.input.gear]
          ?.rpmOptimal || 0,
      sampleCount:
        this.efficiencyMapGenerator.getSampleCount(transformedData.input.gear) ||
        0,
      throttle: transformedData.input.throttle,
      brake: transformedData.input.brake,
      ratioToNextGear: this.gearRatioEstimator.getRatioToNextGear(
        transformedData.input.gear,
      ),
      ratioToPreviousGear: this.gearRatioEstimator.getRatioToPreviousGear(
        transformedData.input.gear,
      ),
      lookupPower: (rpm: number) => this.enginePowerCurve.getPowerAt(rpm),
      powerCurveSampleCount: this.enginePowerCurve.getSampleCount(),
      peakPower: this.enginePowerCurve.getPeakPower(),
    });

    return {
      raw: rawData.raw,
      parsed: transformedData,
      timestamp: Date.now(),
      efficiency: {
        map: efficiencyResult.efficiencyMap,
        recommendations: {
          upshiftRecommended:
            hybridShiftData.recommendation === "upshift" &&
            transformedData.input.gear < MAX_SUPPORTED_GEAR,
          downshiftRecommended:
            hybridShiftData.recommendation === "downshift" &&
            transformedData.input.gear > 1,
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
    // Deep clone: this function mutates nested objects (engine, wheels, input).
    // A shallow `{ ...data }` would still share those nested references with
    // the caller's object, silently mutating it too.
    const validatedData = structuredClone(data);

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
    transformedData.performance.fuel = Number(data.performance.fuel.toFixed(1));

    // Clamp values to realistic ranges
    transformedData.performance.speedKmh = Math.max(
      0,
      Math.min(500, transformedData.performance.speedKmh),
    );
    transformedData.performance.powerKw = Number(
      transformedData.performance.powerKw.toFixed(1),
    );

    return transformedData;
  }
}
