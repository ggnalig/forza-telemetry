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
import {
  GearboxTuneStore,
  GearboxTune,
  ShiftLightPercents,
} from "../services/gearbox-tune-store";
import { RpmCeilingTracker } from "../services/rpm-ceiling-tracker";
import { PerGearRpmCeilingTracker } from "../services/per-gear-rpm-ceiling-tracker";
import { SessionRecorder } from "../services/session-recorder";
import { SettingsStore } from "../services/settings-store";

export class TelemetryProcessor {
  private physicsValidator: PhysicsValidator;
  private rpmCeilingTracker: RpmCeilingTracker;
  private perGearRpmCeilingTracker = new PerGearRpmCeilingTracker();
  /** Throttles how often perGearRpmCeilingTracker's values get written to
   * disk - a hard WOT pull can raise the ceiling on many consecutive
   * frames, and writing the tune on every single one would hammer the CSV
   * file the same way session-recorder.ts's doc comment warns against for
   * per-frame writes. The live gauge itself is unaffected by this throttle
   * (computeEffectiveRpm reads the tracker directly, not the persisted
   * value) - this only delays durability, not the live behavior. */
  private lastGearCeilingPersistAt = 0;
  private static readonly GEAR_CEILING_PERSIST_THROTTLE_MS = 2000;
  private gearboxTuneStore: GearboxTuneStore;
  private sessionRecorder: SessionRecorder;
  private settingsStore: SettingsStore;
  private lastBuildKey: string | null = null;
  /** Set from handleCarChange whenever a GearboxTune is active for the
   * current car - null means no tune has been selected for it. */
  private activeTune: GearboxTune | null = null;

  constructor(
    debugMode = false,
    gearboxTuneStore: GearboxTuneStore = new GearboxTuneStore(),
    sessionRecorder: SessionRecorder = new SessionRecorder(),
    settingsStore: SettingsStore = new SettingsStore(),
  ) {
    this.physicsValidator = new PhysicsValidator(debugMode);
    this.rpmCeilingTracker = new RpmCeilingTracker();
    this.gearboxTuneStore = gearboxTuneStore;
    this.sessionRecorder = sessionRecorder;
    this.settingsStore = settingsStore;
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
   *
   * Also auto-provisions a tune the first time a car is ever seen (no trip
   * to Car Settings required first) - only when NO tune exists at all for
   * that ordinal, not just "none active"; an existing-but-inactive manual
   * tune is never silently replaced. The auto-created tune starts with
   * empty gearRatios (the backend has never required them - only the UI
   * form did, for user-created tunes) and gets its maxRpmPerGearOverride
   * filled in live by perGearRpmCeilingTracker as the car is driven. This
   * means `activeTune` is now essentially never null in practice, so
   * computeBuildKey's composite-key fallback below is a defensive path for
   * an edge case (e.g. a store write failing) rather than the common
   * "untuned car" case it used to be.
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
    let activeTune = this.gearboxTuneStore.getActiveTune(telemetry.car.ordinal);

    if (!activeTune && this.gearboxTuneStore.listTunes(telemetry.car.ordinal).length === 0) {
      const carInfo = lookupCarInfo(telemetry.car.ordinal);
      const autoName = `Auto - ${carInfo?.displayName ?? `Car #${telemetry.car.ordinal}`}`;
      activeTune = this.gearboxTuneStore.createTune(telemetry.car.ordinal, autoName, {});
      this.gearboxTuneStore.setActiveTune(telemetry.car.ordinal, activeTune.id);
    }

    const tuneBuildKey = activeTune?.id ?? null;
    const buildKey = tuneBuildKey ?? computeBuildKey(meta);

    if (this.lastBuildKey !== buildKey) {
      // Flush whatever the OLD tune's tracker discovered before switching
      // away from it - otherwise a value found right before a car change
      // would be lost to the persist throttle's window.
      this.flushGearCeilings();
      this.rpmCeilingTracker.reset();
      this.perGearRpmCeilingTracker.seed(activeTune?.maxRpmPerGearOverride ?? {});
      this.sessionRecorder.onBuildChange(buildKey);
    }

    this.activeTune = activeTune;
    this.lastBuildKey = buildKey;
  }

  /** Persists perGearRpmCeilingTracker's current values into the active
   * tune's maxRpmPerGearOverride, if anything it holds is actually higher
   * than what's already stored - a no-op otherwise, so this is cheap to
   * call speculatively (on the persist throttle, and once more on every
   * build change so nothing pending is lost). */
  private flushGearCeilings(): void {
    const tune = this.activeTune;
    if (!tune) return;

    const existing = tune.maxRpmPerGearOverride ?? {};
    const merged: Record<number, number> = { ...existing };
    let changed = false;
    for (const [gearKey, rpm] of Object.entries(this.perGearRpmCeilingTracker.getAll())) {
      const gear = Number(gearKey);
      if (rpm > (merged[gear] ?? 0)) {
        merged[gear] = rpm;
        changed = true;
      }
    }
    if (!changed) return;

    const updated = this.gearboxTuneStore.updateTune(tune.id, {
      maxRpmPerGearOverride: merged,
    });
    if (updated) this.activeTune = updated;
  }

  /**
   * Resolves what the gauge should actually show for this frame, applying
   * the active tune's RPM corrections (if any) over the game's own reported
   * values - the same "let the user manually fix a value the game gets
   * wrong for this car" escape hatch SimHub offers (see the SimHub
   * comparison research), now with a live auto-refining layer on top:
   *  - maxRpm: the usual chain (maxRpmPerGearOverride[gear], then
   *    maxRpmOverride, then engine.maxRpm) establishes a baseline, and
   *    perGearRpmCeilingTracker's own live-observed ceiling for this gear
   *    is taken INSTEAD only when it's actually HIGHER than that baseline -
   *    never lower. This matters: the tracker only knows what it's seen
   *    this session, so a single early WOT pull that hasn't reached the
   *    real ceiling yet must never SHRINK the gauge's scale below what was
   *    already known good (engine.maxRpm, or a manual override) - it can
   *    only correct upward, the same "engine can't exceed its real
   *    limiter" logic RpmCeilingTracker already uses, just applied per
   *    gear and actually written back instead of staying a passive stat
   *    (see the auto-tune-detection memory for why, and the user's explicit
   *    choice that this should keep climbing even over a manually-set
   *    value once real driving data says otherwise). Reverse (raw gear 0)
   *    and Neutral (raw gear 11 - confirmed empirically in-game, see
   *    parser.ts's gear comment) share a single "N/R" bucket at key 0 -
   *    there's no meaningful separate redline concept for reverse, and the
   *    UI's per-gear override editor only ever writes one combined N/R row.
   *  - redline: redlineOverride if set, otherwise equal to the effective
   *    maxRpm above (matches SimHub's "redline = maxRpm" baseline). Not
   *    auto-tracked - a "how much buffer before the true ceiling" choice is
   *    inherently a preference, not something to observe from driving.
   *  - shiftLightPercents: the tune's own if set, otherwise the persisted
   *    general default (see settings-store.ts - itself seeded from SimHub's
   *    90/95/96% on first run).
   */
  /** Neutral (raw gear 11) and Reverse (raw gear 0) share a single "N/R"
   * bucket at key 0 - see computeEffectiveRpm's doc comment for why. */
  private static perGearKeyFor(gear: number): number {
    return gear === 0 || gear === 11 ? 0 : gear;
  }

  private computeEffectiveRpm(
    telemetry: TelemetryData,
  ): { maxRpm: number; redline: number; shiftLightPercents: ShiftLightPercents } {
    const tune = this.activeTune;
    const perGearKey = TelemetryProcessor.perGearKeyFor(telemetry.input.gear);
    const baselineMaxRpm =
      tune?.maxRpmPerGearOverride?.[perGearKey] ??
      tune?.maxRpmOverride ??
      telemetry.engine.maxRpm;
    const trackedCeiling = this.perGearRpmCeilingTracker.getCeiling(perGearKey);
    const maxRpm =
      trackedCeiling !== undefined ? Math.max(trackedCeiling, baselineMaxRpm) : baselineMaxRpm;
    const redline = tune?.redlineOverride ?? maxRpm;
    const shiftLightPercents =
      tune?.shiftLightPercents ?? this.settingsStore.getGeneralSettings().shiftLightPercents;
    return { maxRpm, redline, shiftLightPercents };
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

    // Live per-gear auto-tracking, feeding computeEffectiveRpm below via the
    // in-memory tracker directly - the disk write further down is purely
    // for durability and must NOT run before computeEffectiveRpm reads
    // this.activeTune this frame. Otherwise a brand-new gear key discovered
    // just now would already show up in tune.maxRpmPerGearOverride by the
    // time the "baseline" is read, collapsing the Math.max safety check
    // above into comparing today's observation against itself.
    const perGearKey = TelemetryProcessor.perGearKeyFor(transformedData.input.gear);
    const raisedGearCeiling = this.perGearRpmCeilingTracker.update(
      perGearKey,
      transformedData.engine.rpm,
      transformedData.input.throttle,
    );

    const effectiveRpm = this.computeEffectiveRpm(transformedData);

    // Persisted to the tune on a throttle (not every frame - see
    // GEAR_CEILING_PERSIST_THROTTLE_MS's doc comment), so a hard WOT pull
    // through several thousand RPM doesn't hammer the CSV file even though
    // it raises the ceiling on nearly every frame. Deliberately after
    // computeEffectiveRpm - see the comment above.
    if (
      raisedGearCeiling &&
      Date.now() - this.lastGearCeilingPersistAt > TelemetryProcessor.GEAR_CEILING_PERSIST_THROTTLE_MS
    ) {
      this.flushGearCeilings();
      this.lastGearCeilingPersistAt = Date.now();
    }

    return {
      raw: rawData.raw,
      parsed: transformedData,
      timestamp: Date.now(),
      carInfo: lookupCarInfo(transformedData.car.ordinal),
      activeTune: this.activeTune,
      diagnostics: {
        observedRpmCeiling,
        effectiveMaxRpm: effectiveRpm.maxRpm,
        effectiveRedline: effectiveRpm.redline,
        shiftLightPercents: effectiveRpm.shiftLightPercents,
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

    // Validate gear vs speed relationship. Neutral is raw gear 11 (confirmed
    // empirically in-game - see parser.ts's gear comment); raw gear 0 is
    // Reverse, which has no such "shouldn't be moving" expectation.
    if (data.input.gear === 11 && data.performance.speedKmh > 5) {
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
