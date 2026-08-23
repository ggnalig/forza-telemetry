// Persists user-entered, exact per-gear ratios as named "tunes". Exists
// because Forza's own tuning menu shows exact per-gear ratios (and final
// drive) for tunable cars, but never exposes them over UDP telemetry - this
// is the only way to record what a build's gearing actually is.
//
// A tune's `id` doubles as the build key TelemetryProcessor uses (see
// handleCarChange's doc comment there) and, going forward, as the key
// recorded sessions are tagged with - this is what lets two different tunes
// of the "same" car (e.g. a 5-speed and a 10-speed build of the same
// car_ordinal) keep fully separate recorded sessions instead of being lumped
// together under one car_ordinal.
//
// A tune also optionally carries manual RPM corrections (maxRpmOverride,
// maxRpmPerGearOverride, redlineOverride, shiftLightPercents) - the same
// escape hatch SimHub offers for when a game's own reported max RPM isn't
// trustworthy for a given car/build (see the redline-accuracy
// investigation). These are deliberately plain user-entered numbers, not
// anything derived/learned - TelemetryProcessor applies them as-is when the
// tune is active (see its doc comment).

import * as crypto from "crypto";
import * as path from "path";
import { readCsvRows, writeCsvRows } from "../utils/csv-store";

/** Fractions of the effective redline at which the shift-light bar changes
 * tier - mirrors SimHub's redline%/shiftlight% mechanism (see the SimHub
 * comparison research): a fixed percentage of max RPM, not anything
 * power-curve-derived. `light1` is where the green/yellow fill begins
 * climbing, `light2` is the blink-orange threshold, `redline` is the
 * blink-red threshold. */
export interface ShiftLightPercents {
  light1: number;
  light2: number;
  redline: number;
}

export interface GearboxTune {
  id: string;
  carOrdinal: number;
  name: string;
  /** Exact per-gear ratio as shown in Forza's tuning menu - final drive and
   * tire size are recorded separately in-game and aren't needed here. */
  gearRatios: Record<number, number>;
  /** Manual replacement for engine.maxRpm when this tune is active -
   * undefined means trust the game's own reported value. */
  maxRpmOverride?: number;
  /** Per-gear replacement for the effective max RPM, keyed by gear number -
   * only the gears present here are overridden; other gears fall back to
   * maxRpmOverride (if set) or engine.maxRpm. Rare in practice (a car's rev
   * limiter is normally one engine-wide value), but some builds/games do
   * report a lower ceiling in specific gears. */
  maxRpmPerGearOverride?: Record<number, number>;
  /** Manual redline value shown on the gauge, independent of max RPM (e.g.
   * "the engine can physically reach 9499 but I want the redline marker at
   * 9000") - undefined means redline equals the effective max RPM. */
  redlineOverride?: number;
  /** Per-tune override of the shift-light thresholds - undefined means fall
   * back to the persisted general default (see settings-store.ts). */
  shiftLightPercents?: ShiftLightPercents;
  createdAt: string;
  updatedAt: string;
}

export interface GearboxTuneOverrides {
  maxRpmOverride?: number;
  maxRpmPerGearOverride?: Record<number, number>;
  redlineOverride?: number;
  shiftLightPercents?: ShiftLightPercents;
}

/** Same fields as GearboxTuneOverrides, but explicitly allowing `undefined`
 * as a real value (not just an absent key) - updateTune uses `"key" in
 * updates` to tell "clear this override" (key present, value undefined)
 * apart from "don't touch this override" (key absent entirely), which
 * `exactOptionalPropertyTypes` otherwise forbids expressing. */
export interface GearboxTuneOverrideUpdates {
  maxRpmOverride?: number | undefined;
  maxRpmPerGearOverride?: Record<number, number> | undefined;
  redlineOverride?: number | undefined;
  shiftLightPercents?: ShiftLightPercents | undefined;
}

const TUNES_FILE = "tunes.csv";
const TUNE_GEAR_RATIOS_FILE = "tune_gear_ratios.csv";
const TUNE_RPM_OVERRIDES_FILE = "tune_rpm_overrides.csv";
const TUNE_GEAR_RPM_OVERRIDES_FILE = "tune_gear_rpm_overrides.csv";
const ACTIVE_TUNE_FILE = "active_tune.csv";

const TUNES_HEADERS = ["id", "car_ordinal", "name", "created_at", "updated_at"];
const TUNE_GEAR_RATIOS_HEADERS = ["tune_id", "gear", "ratio"];
const TUNE_RPM_OVERRIDES_HEADERS = [
  "tune_id",
  "max_rpm_override",
  "redline_override",
  "shift_light1_percent",
  "shift_light2_percent",
  "shift_light_redline_percent",
];
const TUNE_GEAR_RPM_OVERRIDES_HEADERS = ["tune_id", "gear", "max_rpm"];
const ACTIVE_TUNE_HEADERS = ["car_ordinal", "tune_id"];

/** Empty string round-trips through CSV as "unset", distinct from 0. */
function optionalNumberCell(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

/** Drops keys whose value is explicitly `undefined` - the repo's
 * `exactOptionalPropertyTypes` treats "key present with value undefined"
 * differently from "key absent", but callers building these objects from a
 * partial HTTP request body naturally end up with the former. */
function stripUndefined<T extends object>(obj: T): T {
  const result = {} as T;
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result;
}

function parseOptionalNumber(cell: string | undefined): number | undefined {
  return cell === undefined || cell === "" ? undefined : Number(cell);
}

export class GearboxTuneStore {
  private readonly baseDir: string;

  constructor(baseDir: string = path.join(process.cwd(), "data", "db")) {
    this.baseDir = baseDir;
  }

  private filePath(fileName: string): string {
    return path.join(this.baseDir, fileName);
  }

  listTunes(carOrdinal: number): GearboxTune[] {
    return readCsvRows(this.filePath(TUNES_FILE))
      .filter((row) => Number(row[1]) === carOrdinal)
      .map((row) => this.hydrateTune(row));
  }

  /** Every tune across every car - the Car Settings tree's data source
   * (grouped by carOrdinal client-side), unlike listTunes which requires
   * already knowing which car to ask about. */
  listAllTunes(): GearboxTune[] {
    return readCsvRows(this.filePath(TUNES_FILE)).map((row) => this.hydrateTune(row));
  }

  getTune(id: string): GearboxTune | null {
    const row = readCsvRows(this.filePath(TUNES_FILE)).find((r) => r[0] === id);
    return row ? this.hydrateTune(row) : null;
  }

  createTune(
    carOrdinal: number,
    name: string,
    gearRatios: Record<number, number>,
    overrides: GearboxTuneOverrides = {},
  ): GearboxTune {
    const now = new Date().toISOString();
    const tune: GearboxTune = {
      id: crypto.randomUUID(),
      carOrdinal,
      name,
      gearRatios,
      ...stripUndefined(overrides),
      createdAt: now,
      updatedAt: now,
    };
    this.persistTune(tune);
    return tune;
  }

  updateTune(
    id: string,
    updates: { name?: string; gearRatios?: Record<number, number> } & GearboxTuneOverrideUpdates,
  ): GearboxTune | null {
    const existing = this.getTune(id);
    if (!existing) return null;

    // Fields below are typed `number | undefined` from the ternaries -
    // stripUndefined removes any that end up undefined at runtime so the
    // result actually satisfies GearboxTune's optional fields; the cast
    // just tells TS that's the intended shape going in.
    const updated: GearboxTune = stripUndefined({
      ...existing,
      name: updates.name ?? existing.name,
      gearRatios: updates.gearRatios ?? existing.gearRatios,
      maxRpmOverride:
        "maxRpmOverride" in updates ? updates.maxRpmOverride : existing.maxRpmOverride,
      maxRpmPerGearOverride:
        "maxRpmPerGearOverride" in updates
          ? updates.maxRpmPerGearOverride
          : existing.maxRpmPerGearOverride,
      redlineOverride:
        "redlineOverride" in updates ? updates.redlineOverride : existing.redlineOverride,
      shiftLightPercents:
        "shiftLightPercents" in updates
          ? updates.shiftLightPercents
          : existing.shiftLightPercents,
      updatedAt: new Date().toISOString(),
    } as GearboxTune);
    this.persistTune(updated);
    return updated;
  }

  deleteTune(id: string): boolean {
    const tunesPath = this.filePath(TUNES_FILE);
    const rows = readCsvRows(tunesPath);
    const remaining = rows.filter((row) => row[0] !== id);
    if (remaining.length === rows.length) return false;
    writeCsvRows(tunesPath, TUNES_HEADERS, remaining);

    const ratiosPath = this.filePath(TUNE_GEAR_RATIOS_FILE);
    writeCsvRows(
      ratiosPath,
      TUNE_GEAR_RATIOS_HEADERS,
      readCsvRows(ratiosPath).filter((row) => row[0] !== id),
    );

    const overridesPath = this.filePath(TUNE_RPM_OVERRIDES_FILE);
    writeCsvRows(
      overridesPath,
      TUNE_RPM_OVERRIDES_HEADERS,
      readCsvRows(overridesPath).filter((row) => row[0] !== id),
    );

    const gearOverridesPath = this.filePath(TUNE_GEAR_RPM_OVERRIDES_FILE);
    writeCsvRows(
      gearOverridesPath,
      TUNE_GEAR_RPM_OVERRIDES_HEADERS,
      readCsvRows(gearOverridesPath).filter((row) => row[0] !== id),
    );

    // Clear any active-tune pointer that referenced the now-deleted tune.
    const activePath = this.filePath(ACTIVE_TUNE_FILE);
    writeCsvRows(
      activePath,
      ACTIVE_TUNE_HEADERS,
      readCsvRows(activePath).filter((row) => row[1] !== id),
    );

    return true;
  }

  /** The last tune explicitly selected for this car_ordinal, or null if none
   * has been chosen (or it was later deactivated) - never auto-guessed, see
   * file doc comment for why. */
  getActiveTune(carOrdinal: number): GearboxTune | null {
    const row = readCsvRows(this.filePath(ACTIVE_TUNE_FILE)).find(
      (r) => Number(r[0]) === carOrdinal,
    );
    return row ? this.getTune(row[1]) : null;
  }

  /** Pass `tuneId: null` to deactivate. */
  setActiveTune(carOrdinal: number, tuneId: string | null): void {
    const activePath = this.filePath(ACTIVE_TUNE_FILE);
    const rows = readCsvRows(activePath).filter(
      (row) => Number(row[0]) !== carOrdinal,
    );
    if (tuneId) {
      rows.push([String(carOrdinal), tuneId]);
    }
    writeCsvRows(activePath, ACTIVE_TUNE_HEADERS, rows);
  }

  private persistTune(tune: GearboxTune): void {
    const tunesPath = this.filePath(TUNES_FILE);
    const otherTuneRows = readCsvRows(tunesPath).filter(
      (row) => row[0] !== tune.id,
    );
    writeCsvRows(tunesPath, TUNES_HEADERS, [
      ...otherTuneRows,
      [tune.id, tune.carOrdinal, tune.name, tune.createdAt, tune.updatedAt],
    ]);

    const ratiosPath = this.filePath(TUNE_GEAR_RATIOS_FILE);
    const otherRatioRows = readCsvRows(ratiosPath).filter(
      (row) => row[0] !== tune.id,
    );
    const ownRatioRows = Object.entries(tune.gearRatios).map(
      ([gear, ratio]) => [tune.id, Number(gear), ratio],
    );
    writeCsvRows(ratiosPath, TUNE_GEAR_RATIOS_HEADERS, [
      ...otherRatioRows,
      ...ownRatioRows,
    ]);

    const overridesPath = this.filePath(TUNE_RPM_OVERRIDES_FILE);
    const otherOverrideRows = readCsvRows(overridesPath).filter(
      (row) => row[0] !== tune.id,
    );
    writeCsvRows(overridesPath, TUNE_RPM_OVERRIDES_HEADERS, [
      ...otherOverrideRows,
      [
        tune.id,
        optionalNumberCell(tune.maxRpmOverride),
        optionalNumberCell(tune.redlineOverride),
        optionalNumberCell(tune.shiftLightPercents?.light1),
        optionalNumberCell(tune.shiftLightPercents?.light2),
        optionalNumberCell(tune.shiftLightPercents?.redline),
      ],
    ]);

    const gearOverridesPath = this.filePath(TUNE_GEAR_RPM_OVERRIDES_FILE);
    const otherGearOverrideRows = readCsvRows(gearOverridesPath).filter(
      (row) => row[0] !== tune.id,
    );
    const ownGearOverrideRows = Object.entries(
      tune.maxRpmPerGearOverride ?? {},
    ).map(([gear, maxRpm]) => [tune.id, Number(gear), maxRpm]);
    writeCsvRows(gearOverridesPath, TUNE_GEAR_RPM_OVERRIDES_HEADERS, [
      ...otherGearOverrideRows,
      ...ownGearOverrideRows,
    ]);
  }

  private hydrateTune(tuneRow: string[]): GearboxTune {
    const id = tuneRow[0];
    const gearRatios: Record<number, number> = {};
    for (const row of readCsvRows(this.filePath(TUNE_GEAR_RATIOS_FILE))) {
      if (row[0] === id) {
        gearRatios[Number(row[1])] = Number(row[2]);
      }
    }

    const maxRpmPerGearOverride: Record<number, number> = {};
    for (const row of readCsvRows(this.filePath(TUNE_GEAR_RPM_OVERRIDES_FILE))) {
      if (row[0] === id) {
        maxRpmPerGearOverride[Number(row[1])] = Number(row[2]);
      }
    }

    const overrideRow = readCsvRows(this.filePath(TUNE_RPM_OVERRIDES_FILE)).find(
      (row) => row[0] === id,
    );
    const light1 = parseOptionalNumber(overrideRow?.[3]);
    const light2 = parseOptionalNumber(overrideRow?.[4]);
    const redline = parseOptionalNumber(overrideRow?.[5]);

    return stripUndefined({
      id,
      carOrdinal: Number(tuneRow[1]),
      name: tuneRow[2],
      gearRatios,
      maxRpmOverride: parseOptionalNumber(overrideRow?.[1]),
      maxRpmPerGearOverride:
        Object.keys(maxRpmPerGearOverride).length > 0
          ? maxRpmPerGearOverride
          : undefined,
      redlineOverride: parseOptionalNumber(overrideRow?.[2]),
      shiftLightPercents:
        light1 !== undefined && light2 !== undefined && redline !== undefined
          ? { light1, light2, redline }
          : undefined,
      createdAt: tuneRow[3],
      updatedAt: tuneRow[4],
    } as GearboxTune);
  }
}
