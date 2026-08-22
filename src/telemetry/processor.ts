// Telemetry Processor for FH6 Data Out 324-byte format
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
  computeBuildKey,
} from "../services/car-profile-store";
import { lookupCarInfo } from "../services/car-database";
import {
  GearboxTuneStore,
  GearboxTune,
  tuneRatioBetween,
} from "../services/gearbox-tune-store";

export class TelemetryProcessor {
  private physicsValidator: PhysicsValidator;
  private efficiencyMapGenerator: GearEfficiencyMapGenerator;
  private gearRatioEstimator: GearRatioEstimator;
  private enginePowerCurve: EnginePowerCurve;
  private shiftEngine: ShiftEngine;
  private carProfileStore: CarProfileStore;
  private gearboxTuneStore: GearboxTuneStore;
  private lastBuildKey: string | null = null;
  private lastCarMeta: CarMeta | null = null;
  /** Set from handleCarChange whenever a GearboxTune is active for the
   * current car - null means "use GearRatioEstimator's estimate" (the
   * default, unmanaged behavior). */
  private activeTune: GearboxTune | null = null;
  /** The active tune's own id, used in place of computeBuildKey's output
   * when saving/loading this build's CarProfileStore data - null falls back
   * to the auto-computed key. */
  private activeTuneBuildKey: string | null = null;
  /** A profile loaded from disk that hasn't been verified against fresh
   * telemetry yet - see handleCarChange's doc comment and tryVerifyPendingProfile. */
  private pendingProfile: CarProfile | null = null;
  private readonly PENDING_PROFILE_VERIFY_TOLERANCE = 0.08; // 8% relative gear-ratio difference
  /** Persistence otherwise only happens on a car change (the outgoing car's
   * profile) or a graceful process shutdown - a long single-car session that
   * ends in a force-kill/crash would save nothing at all. This timer saves
   * the active car's in-progress profile periodically too, so an ungraceful
   * exit only ever loses the last few minutes of learning, not the whole
   * session. */
  private lastAutosaveAt: number = 0;
  private static readonly AUTOSAVE_INTERVAL_MS = 30_000;

  constructor(
    debugMode = false,
    carProfileStore: CarProfileStore = new CarProfileStore(),
    gearboxTuneStore: GearboxTuneStore = new GearboxTuneStore(),
  ) {
    this.physicsValidator = new PhysicsValidator(debugMode);
    this.efficiencyMapGenerator = new GearEfficiencyMapGenerator();
    this.gearRatioEstimator = new GearRatioEstimator();
    this.enginePowerCurve = new EnginePowerCurve();
    this.shiftEngine = new ShiftEngine();
    this.carProfileStore = carProfileStore;
    this.gearboxTuneStore = gearboxTuneStore;
  }

  /**
   * Every car BUILD in Forza has its own gearing/power characteristics -
   * learned state from a previous build must not bleed into predictions for
   * a new one. `car.ordinal` alone isn't enough to key this: Forza reuses the
   * same ordinal for every owned copy of a car model, so two builds of the
   * same car (e.g. an engine swap or a cam upgrade that shifted the redline)
   * would otherwise collide. `computeBuildKey` folds in numCylinders/maxRpm/
   * drivetrain too - see its doc comment for what this can and can't catch.
   * The outgoing build's state is saved to disk first so it can warm-start
   * next time it's driven; the incoming build's saved profile (if any) is held
   * as an unverified `pendingProfile` rather than imported immediately - see
   * tryVerifyPendingProfile for why (the composite key can still match two
   * builds that differ in ways it can't see, e.g. a bolt-on turbo or a manual
   * gear ratio retune with the same engine/redline/drivetrain).
   *
   * When a GearboxTune is active for this car (see gearbox-tune-store.ts),
   * its own `id` is used AS the build key instead of computeBuildKey's
   * output - this is what gives two different tunes of the "same" car
   * (identical engine/redline/drivetrain, e.g. a 5-speed vs a 10-speed
   * build) fully separate learned data, closing a gap the composite key
   * above can't: it has no gear-count component at all.
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

    // Deliberately NOT gated on `this.lastBuildKey !== null`: the very first
    // frame of a fresh process run must also try to load a saved profile
    // (e.g. the app was restarted mid-session, or this is just "today's
    // first drive" of a car you've driven before). The inner `lastCarMeta`
    // check below already skips the save/reset on that first frame since
    // there's nothing yet to save.
    if (this.lastBuildKey !== buildKey) {
      if (this.lastCarMeta) {
        this.carProfileStore.save(
          this.exportCarProfile(this.lastCarMeta),
          this.activeTuneBuildKey ?? undefined,
        );
      }

      this.efficiencyMapGenerator.reset();
      this.gearRatioEstimator.reset();
      this.enginePowerCurve.reset();
      this.shiftEngine.reset();

      this.pendingProfile = this.carProfileStore.load(meta, tuneBuildKey ?? undefined);
    }

    this.activeTune = activeTune;
    this.activeTuneBuildKey = tuneBuildKey;
    this.lastBuildKey = buildKey;
    this.lastCarMeta = meta;
  }

  /** Exact ratio from the active GearboxTune when one exists for this car,
   * otherwise GearRatioEstimator's statistical estimate. */
  private getRatioToNextGear(gear: number): number | null {
    if (this.activeTune) {
      return tuneRatioBetween(this.activeTune, gear, gear + 1);
    }
    return this.gearRatioEstimator.getRatioToNextGear(gear);
  }

  private getRatioToPreviousGear(gear: number): number | null {
    if (this.activeTune) {
      return tuneRatioBetween(this.activeTune, gear, gear - 1);
    }
    return this.gearRatioEstimator.getRatioToPreviousGear(gear);
  }

  /**
   * A saved profile matching the composite build key isn't necessarily the
   * SAME build - two builds can share ordinal/numCylinders/maxRpm/drivetrain
   * while differing in ways that key can't see (bolt-on power, a manual gear
   * ratio retune). So a loaded profile is held as `pendingProfile` and only
   * trusted once a fresh gear-ratio reading confirms it: as soon as any gear
   * the pending profile has data for reaches enough freshly-observed samples
   * this session, compare the two. Close enough -> import the full profile
   * (power curve, other gears, shift history) for the usual warm-start. Too
   * far off -> discard it and keep learning from scratch, so a mismatched
   * profile never gets a chance to feed a wrong prediction. If the session
   * ends before any comparison is possible, the candidate is simply dropped
   * (same as a mismatch) rather than merged - the rarer edge case of losing
   * an ultimately-still-valid profile is an accepted trade-off for keeping
   * this logic simple.
   */
  private tryVerifyPendingProfile(gear: number): void {
    if (!this.pendingProfile) return;

    const pendingRatio = this.pendingProfile.gearRatios[gear];
    if (!pendingRatio) return; // no saved data for this gear - wait for one that has some

    const freshRatio = this.gearRatioEstimator.getRatio(gear);
    if (freshRatio === null) return; // not enough fresh samples yet to compare

    const relativeDiff =
      Math.abs(freshRatio - pendingRatio.ratioMedian) / pendingRatio.ratioMedian;

    if (relativeDiff <= this.PENDING_PROFILE_VERIFY_TOLERANCE) {
      this.importCarProfile(this.pendingProfile);
    } else {
      console.warn(
        `⚠️  Learned profile mismatch for this car (gear ${gear}: saved ratio ~${pendingRatio.ratioMedian.toFixed(1)}, observed ~${freshRatio.toFixed(1)}) - ` +
          "looks like a different build under the same identity key. Discarding saved profile, learning fresh.",
      );
    }

    this.pendingProfile = null; // resolved either way - imported or discarded
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
      this.carProfileStore.save(
        this.exportCarProfile(this.lastCarMeta),
        this.activeTuneBuildKey ?? undefined,
      );
    }
  }

  /** Saves the active car's in-progress profile every AUTOSAVE_INTERVAL_MS
   * while telemetry is actively flowing - see the field doc comment above. */
  private tryAutosave(): void {
    if (!this.lastCarMeta) return;

    const now = Date.now();
    if (now - this.lastAutosaveAt < TelemetryProcessor.AUTOSAVE_INTERVAL_MS) {
      return;
    }

    this.carProfileStore.save(
      this.exportCarProfile(this.lastCarMeta),
      this.activeTuneBuildKey ?? undefined,
    );
    this.lastAutosaveAt = now;
  }

  /**
   * Process and transform telemetry data
   * Validates data consistency and applies transformations
   */
  public process(rawData: ParsedTelemetryData): ProcessedTelemetryData {
    const telemetry = rawData.parsed;

    this.handleCarChange(telemetry);
    this.tryAutosave();

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
    this.tryVerifyPendingProfile(transformedData.input.gear);

    // Feed the pooled (gear-independent) WOT power curve used for the
    // cross-gear optimal shift point calculation.
    this.enginePowerCurve.update(
      transformedData.engine.rpm,
      transformedData.performance.powerKw,
      transformedData.input.throttle,
      transformedData.engine.maxRpm,
    );

    // Update efficiency map with current telemetry
    const efficiencyMap = this.efficiencyMapGenerator.update({
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
        efficiencyMap[transformedData.input.gear]?.rpmOptimal || 0,
      sampleCount:
        this.efficiencyMapGenerator.getSampleCount(transformedData.input.gear) ||
        0,
      throttle: transformedData.input.throttle,
      brake: transformedData.input.brake,
      ratioToNextGear: this.getRatioToNextGear(transformedData.input.gear),
      ratioToPreviousGear: this.getRatioToPreviousGear(
        transformedData.input.gear,
      ),
      lookupPower: (rpm: number) => this.enginePowerCurve.getPowerAt(rpm),
      powerCurveSampleCount: this.enginePowerCurve.getSampleCount(),
      peakPower: this.enginePowerCurve.getPeakPower(),
      isColliding: transformedData.collision.smashableVelDiff > 0,
      isOnRumbleStrip:
        transformedData.wheels.onRumbleStrip.frontLeft === 1 ||
        transformedData.wheels.onRumbleStrip.frontRight === 1 ||
        transformedData.wheels.onRumbleStrip.rearLeft === 1 ||
        transformedData.wheels.onRumbleStrip.rearRight === 1,
    });

    return {
      raw: rawData.raw,
      parsed: transformedData,
      timestamp: Date.now(),
      carInfo: lookupCarInfo(transformedData.car.ordinal),
      activeTune: this.activeTune,
      efficiency: {
        map: efficiencyMap,
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
