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

import * as crypto from "crypto";
import * as path from "path";
import { readCsvRows, writeCsvRows } from "../utils/csv-store";

export interface GearboxTune {
  id: string;
  carOrdinal: number;
  name: string;
  /** Exact per-gear ratio as shown in Forza's tuning menu - final drive and
   * tire size are recorded separately in-game and aren't needed here. */
  gearRatios: Record<number, number>;
  createdAt: string;
  updatedAt: string;
}

const TUNES_FILE = "tunes.csv";
const TUNE_GEAR_RATIOS_FILE = "tune_gear_ratios.csv";
const ACTIVE_TUNE_FILE = "active_tune.csv";

const TUNES_HEADERS = ["id", "car_ordinal", "name", "created_at", "updated_at"];
const TUNE_GEAR_RATIOS_HEADERS = ["tune_id", "gear", "ratio"];
const ACTIVE_TUNE_HEADERS = ["car_ordinal", "tune_id"];

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

  getTune(id: string): GearboxTune | null {
    const row = readCsvRows(this.filePath(TUNES_FILE)).find((r) => r[0] === id);
    return row ? this.hydrateTune(row) : null;
  }

  createTune(
    carOrdinal: number,
    name: string,
    gearRatios: Record<number, number>,
  ): GearboxTune {
    const now = new Date().toISOString();
    const tune: GearboxTune = {
      id: crypto.randomUUID(),
      carOrdinal,
      name,
      gearRatios,
      createdAt: now,
      updatedAt: now,
    };
    this.persistTune(tune);
    return tune;
  }

  updateTune(
    id: string,
    updates: { name?: string; gearRatios?: Record<number, number> },
  ): GearboxTune | null {
    const existing = this.getTune(id);
    if (!existing) return null;

    const updated: GearboxTune = {
      ...existing,
      name: updates.name ?? existing.name,
      gearRatios: updates.gearRatios ?? existing.gearRatios,
      updatedAt: new Date().toISOString(),
    };
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
  }

  private hydrateTune(tuneRow: string[]): GearboxTune {
    const id = tuneRow[0];
    const gearRatios: Record<number, number> = {};
    for (const row of readCsvRows(this.filePath(TUNE_GEAR_RATIOS_FILE))) {
      if (row[0] === id) {
        gearRatios[Number(row[1])] = Number(row[2]);
      }
    }
    return {
      id,
      carOrdinal: Number(tuneRow[1]),
      name: tuneRow[2],
      gearRatios,
      createdAt: tuneRow[3],
      updatedAt: tuneRow[4],
    };
  }
}
