// Telemetry Processor for FH6 Data Out 324-byte format
// Data transformation and validation layer for structured telemetry

import {
  TelemetryData,
  ParsedTelemetryData,
  ProcessedTelemetryData,
} from "../types/telemetry";
import { PhysicsValidator } from "./physics-validator";
import { CarMeta, computeBuildKey } from "./car-meta";
import { lookupCarInfo } from "../services/car-database";
import { GearboxTuneStore, GearboxTune } from "../services/gearbox-tune-store";
import { RpmCeilingTracker } from "../services/rpm-ceiling-tracker";
import { SessionRecorder } from "../services/session-recorder";

export class TelemetryProcessor {
  private physicsValidator: PhysicsValidator;
  private rpmCeilingTracker: RpmCeilingTracker;
  private gearboxTuneStore: GearboxTuneStore;
  private sessionRecorder: SessionRecorder;
  private lastBuildKey: string | null = null;
  /** Set from handleCarChange whenever a GearboxTune is active for the
   * current car - null means no tune has been selected for it. */
  private activeTune: GearboxTune | null = null;

  constructor(
    debugMode = false,
    gearboxTuneStore: GearboxTuneStore = new GearboxTuneStore(),
    sessionRecorder: SessionRecorder = new SessionRecorder(),
  ) {
    this.physicsValidator = new PhysicsValidator(debugMode);
    this.rpmCeilingTracker = new RpmCeilingTracker();
    this.gearboxTuneStore = gearboxTuneStore;
    this.sessionRecorder = sessionRecorder;
  }

  /**
   * Every car BUILD in Forza has its own gearing/engine characteristics.
   * `car.ordinal` alone isn't enough to identify one: Forza reuses the same
   * ordinal for every owned copy of a car model, so two builds of the same
   * car (e.g. an engine swap or a cam upgrade that shifted the redline)
   * would otherwise be indistinguishable. `computeBuildKey` folds in
   * numCylinders/maxRpm/drivetrain too - see its doc comment for what this
   * can and can't catch.
   *
   * When a GearboxTune is active for this car (see gearbox-tune-store.ts),
   * its own `id` is used AS the build key instead of computeBuildKey's
   * output - this is what gives two different tunes of the "same" car
   * (identical engine/redline/drivetrain, e.g. a 5-speed vs a 10-speed
   * build) distinct identities, closing a gap the composite key above can't:
   * it has no gear-count component at all.
   *
   * This same tune-aware key is also what resets `rpmCeilingTracker` (see
   * its own doc comment) correctly across a modification that changes the
   * true rev ceiling WITHOUT engine.maxRpm reflecting it - a case
   * computeBuildKey can't detect on its own since it keys off maxRpm
   * itself. Switching to (or creating) a new tune whenever you know a
   * modification changed something is what actually resets the tracker in
   * that case, not any automatic detection.
   *
   * A build-key change also finalizes any in-progress recorded session (see
   * SessionRecorder.onBuildChange) - a session's frames should never span
   * two different builds.
   */
  private handleCarChange(telemetry: TelemetryData): void {
    const meta: CarMeta = {
      carOrdinal: telemetry.car.ordinal,
      carClass: telemetry.car.class,
      performanceIndex: telemetry.car.performanceIndex,
      drivetrain: telemetry.car.drivetrain,
      numCylinders: telemetry.engine.cylinders,
      idleRpm: telemetry.engine.idleRpm,
      maxRpm: telemetry.engine.maxRpm,
    };
    const activeTune = this.gearboxTuneStore.getActiveTune(telemetry.car.ordinal);
    const tuneBuildKey = activeTune?.id ?? null;
    const buildKey = tuneBuildKey ?? computeBuildKey(meta);

    if (this.lastBuildKey !== buildKey) {
      this.rpmCeilingTracker.reset();
      this.sessionRecorder.onBuildChange(buildKey);
    }

    this.activeTune = activeTune;
    this.lastBuildKey = buildKey;
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

    // Feed the empirical rev-ceiling tracker: the engine can't physically
    // exceed its real limiter, so the highest rpm ever seen at WOT converges
    // to the true redline regardless of what engine.maxRpm claims - logged
    // whenever it climbs so this can be cross-checked against maxRpm from a
    // real driving session (see the redline-accuracy investigation).
    const previousCeiling = this.rpmCeilingTracker.getCeiling();
    this.rpmCeilingTracker.update(
      transformedData.engine.rpm,
      transformedData.input.throttle,
    );
    const observedRpmCeiling = this.rpmCeilingTracker.getCeiling();
    if (observedRpmCeiling > previousCeiling) {
      console.log(
        `📈 New observed rpm ceiling: ${observedRpmCeiling.toFixed(0)} ` +
          `(engine.maxRpm reports ${transformedData.engine.maxRpm.toFixed(0)})`,
      );
    }

    // `this.lastBuildKey` is always the current frame's build key by this
    // point - handleCarChange sets it unconditionally every frame, not just
    // on a change.
    this.sessionRecorder.onFrame(transformedData, this.lastBuildKey!);

    return {
      raw: rawData.raw,
      parsed: transformedData,
      timestamp: Date.now(),
      carInfo: lookupCarInfo(transformedData.car.ordinal),
      activeTune: this.activeTune,
      diagnostics: {
        observedRpmCeiling,
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
