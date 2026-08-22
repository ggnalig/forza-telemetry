// Persists learned per-car shift/gearing state as a small CSV "database" -
// one file per table, keyed by Forza's `car.ordinal`, so switching back to a
// car you've already driven warm-starts the model instead of relearning it
// from scratch every session. CSV (not JSON) is deliberate: every file is
// directly openable/plottable in a spreadsheet for inspecting or tuning the
// learned model by hand.
//
// Only derived summaries are persisted (medians, optimal rpm, power-per-bucket),
// never the raw rolling sample buffers each service keeps in memory - those
// buffers are working sets for computing the summary, not the knowledge
// itself, and naturally rebuild after a few frames of new driving.

import * as fs from "fs";
import * as path from "path";
import { GearRatioSummary } from "./gear-ratio-estimator";
import { GearEfficiencySummary } from "./gear-efficiency-map-generator";
import { EnginePowerCurve } from "./engine-power-curve";
import { ShiftHistory } from "./shift-engine";

export interface CarMeta {
  carOrdinal: number;
  carClass: number;
  performanceIndex: number;
  drivetrain: number;
  numCylinders: number;
  idleRpm: number;
  maxRpm: number;
}

export interface CarProfile {
  meta: CarMeta;
  gearRatios: GearRatioSummary;
  gearEfficiency: GearEfficiencySummary;
  powerCurve: ReturnType<EnginePowerCurve["exportState"]>;
  shiftHistory: ShiftHistory;
}

const CARS_FILE = "cars.csv";
const GEAR_RATIOS_FILE = "gear_ratios.csv";
const GEAR_EFFICIENCY_FILE = "gear_efficiency.csv";
const POWER_CURVE_FILE = "power_curve.csv";
const SHIFT_HISTORY_FILE = "shift_history.csv";

const CARS_HEADERS = [
  "car_ordinal",
  "car_class",
  "performance_index",
  "drivetrain",
  "num_cylinders",
  "idle_rpm",
  "max_rpm",
  "gears_learned",
  "total_wot_samples",
  "last_updated",
];

const GEAR_RATIOS_HEADERS = [
  "car_ordinal",
  "car_class",
  "gear",
  "ratio_median",
  "ratio_sample_count",
];

const GEAR_EFFICIENCY_HEADERS = [
  "car_ordinal",
  "car_class",
  "gear",
  "rpm_min",
  "rpm_max",
  "rpm_avg",
  "rpm_optimal",
  "observed_rpm_low",
  "observed_rpm_high",
  "wot_sample_count",
  "total_sample_count",
];

const POWER_CURVE_HEADERS = ["car_ordinal", "car_class", "rpm_bucket", "power_kw"];

const SHIFT_HISTORY_HEADERS = [
  "car_ordinal",
  "car_class",
  "gear",
  "shift_rpm",
  "outcome_score",
  "recorded_at",
];

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Every field in this store is numeric or an ISO timestamp - no commas or
 * quotes ever appear in a value, so a hand-rolled CSV reader/writer is safe
 * and avoids pulling in a parsing dependency for a five-file hobby dataset. */
function readCsvRows(filePath: string): string[][] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8").trim();
  if (!content) return [];
  return content
    .split("\n")
    .slice(1) // drop header row
    .filter((line) => line.length > 0)
    .map((line) => line.split(","));
}

function writeCsvRows(
  filePath: string,
  headers: string[],
  rows: (string | number)[][],
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [headers.join(","), ...rows.map((row) => row.join(","))];
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
}

export class CarProfileStore {
  private readonly baseDir: string;

  constructor(baseDir: string = path.join(process.cwd(), "data", "db")) {
    this.baseDir = baseDir;
  }

  save(profile: CarProfile): void {
    try {
      this.saveCars(profile);
      this.saveGearRatios(profile);
      this.saveGearEfficiency(profile);
      this.savePowerCurve(profile);
      this.saveShiftHistory(profile);
    } catch (error) {
      console.error(
        `⚠️  Failed to save car profile for ordinal ${profile.meta.carOrdinal}:`,
        error,
      );
    }
  }

  load(carOrdinal: number): CarProfile | null {
    try {
      const meta = this.loadCarMeta(carOrdinal);
      if (!meta) return null;

      return {
        meta,
        gearRatios: this.loadGearRatios(carOrdinal),
        gearEfficiency: this.loadGearEfficiency(carOrdinal),
        powerCurve: this.loadPowerCurve(carOrdinal, meta),
        shiftHistory: this.loadShiftHistory(carOrdinal),
      };
    } catch (error) {
      console.error(
        `⚠️  Failed to load car profile for ordinal ${carOrdinal}:`,
        error,
      );
      return null;
    }
  }

  private filePath(fileName: string): string {
    return path.join(this.baseDir, fileName);
  }

  /** Drops any existing rows for this car (column 0 is always car_ordinal) and appends the new ones. */
  private replaceCarRows(
    fileName: string,
    headers: string[],
    carOrdinal: number,
    newRows: (string | number)[][],
  ): void {
    const filePath = this.filePath(fileName);
    const keptRows = readCsvRows(filePath).filter(
      (row) => Number(row[0]) !== carOrdinal,
    );
    writeCsvRows(filePath, headers, [...keptRows, ...newRows]);
  }

  private loadCarRows(fileName: string, carOrdinal: number): string[][] {
    return readCsvRows(this.filePath(fileName)).filter(
      (row) => Number(row[0]) === carOrdinal,
    );
  }

  // ---- cars.csv ----

  private saveCars(profile: CarProfile): void {
    const { meta } = profile;
    const row = [
      meta.carOrdinal,
      meta.carClass,
      meta.performanceIndex,
      meta.drivetrain,
      meta.numCylinders,
      meta.idleRpm,
      meta.maxRpm,
      Object.keys(profile.gearRatios).length,
      profile.powerCurve.sampleCount,
      new Date().toISOString(),
    ];
    this.replaceCarRows(CARS_FILE, CARS_HEADERS, meta.carOrdinal, [row]);
  }

  private loadCarMeta(carOrdinal: number): CarMeta | null {
    const [row] = this.loadCarRows(CARS_FILE, carOrdinal);
    if (!row) return null;

    return {
      carOrdinal: Number(row[0]),
      carClass: Number(row[1]),
      performanceIndex: Number(row[2]),
      drivetrain: Number(row[3]),
      numCylinders: Number(row[4]),
      idleRpm: Number(row[5]),
      maxRpm: Number(row[6]),
    };
  }

  private getTotalWotSamples(carOrdinal: number): number {
    const [row] = this.loadCarRows(CARS_FILE, carOrdinal);
    return row ? Number(row[8]) : 0;
  }

  // ---- gear_ratios.csv ----

  private saveGearRatios(profile: CarProfile): void {
    const rows = Object.entries(profile.gearRatios).map(([gear, summary]) => [
      profile.meta.carOrdinal,
      profile.meta.carClass,
      Number(gear),
      round(summary.ratioMedian, 3),
      summary.sampleCount,
    ]);
    this.replaceCarRows(
      GEAR_RATIOS_FILE,
      GEAR_RATIOS_HEADERS,
      profile.meta.carOrdinal,
      rows,
    );
  }

  private loadGearRatios(carOrdinal: number): GearRatioSummary {
    const summary: GearRatioSummary = {};
    for (const row of this.loadCarRows(GEAR_RATIOS_FILE, carOrdinal)) {
      summary[Number(row[2])] = {
        ratioMedian: Number(row[3]),
        sampleCount: Number(row[4]),
      };
    }
    return summary;
  }

  // ---- gear_efficiency.csv ----

  private saveGearEfficiency(profile: CarProfile): void {
    const rows = Object.entries(profile.gearEfficiency).map(([gear, s]) => [
      profile.meta.carOrdinal,
      profile.meta.carClass,
      Number(gear),
      Math.round(s.rpmMin),
      Math.round(s.rpmMax),
      Math.round(s.rpmAvg),
      Math.round(s.rpmOptimal),
      Math.round(s.observedRpmLow),
      Math.round(s.observedRpmHigh),
      s.wotSampleCount,
      s.totalSampleCount,
    ]);
    this.replaceCarRows(
      GEAR_EFFICIENCY_FILE,
      GEAR_EFFICIENCY_HEADERS,
      profile.meta.carOrdinal,
      rows,
    );
  }

  private loadGearEfficiency(carOrdinal: number): GearEfficiencySummary {
    const summary: GearEfficiencySummary = {};
    for (const row of this.loadCarRows(GEAR_EFFICIENCY_FILE, carOrdinal)) {
      summary[Number(row[2])] = {
        rpmMin: Number(row[3]),
        rpmMax: Number(row[4]),
        rpmAvg: Number(row[5]),
        rpmOptimal: Number(row[6]),
        observedRpmLow: Number(row[7]),
        observedRpmHigh: Number(row[8]),
        wotSampleCount: Number(row[9]),
        totalSampleCount: Number(row[10]),
      };
    }
    return summary;
  }

  // ---- power_curve.csv ----

  private savePowerCurve(profile: CarProfile): void {
    const rows = Object.entries(profile.powerCurve.powerByRpmBucket).map(
      ([bucket, power]) => [
        profile.meta.carOrdinal,
        profile.meta.carClass,
        Number(bucket),
        round(power, 1),
      ],
    );
    this.replaceCarRows(
      POWER_CURVE_FILE,
      POWER_CURVE_HEADERS,
      profile.meta.carOrdinal,
      rows,
    );
  }

  /** sampleCount isn't per-bucket, so it's carried in cars.csv's total_wot_samples column. */
  private loadPowerCurve(
    carOrdinal: number,
    meta: CarMeta,
  ): ReturnType<EnginePowerCurve["exportState"]> {
    const powerByRpmBucket: { [rpmBucket: number]: number } = {};
    for (const row of this.loadCarRows(POWER_CURVE_FILE, carOrdinal)) {
      powerByRpmBucket[Number(row[2])] = Number(row[3]);
    }
    return {
      powerByRpmBucket,
      sampleCount: this.getTotalWotSamples(meta.carOrdinal),
    };
  }

  // ---- shift_history.csv ----

  private saveShiftHistory(profile: CarProfile): void {
    const rows: (string | number)[][] = [];
    for (const [gear, outcomes] of Object.entries(profile.shiftHistory)) {
      for (const outcome of outcomes) {
        rows.push([
          profile.meta.carOrdinal,
          profile.meta.carClass,
          Number(gear),
          Math.round(outcome.rpm),
          round(outcome.score, 1),
          new Date(outcome.timestamp).toISOString(),
        ]);
      }
    }
    this.replaceCarRows(
      SHIFT_HISTORY_FILE,
      SHIFT_HISTORY_HEADERS,
      profile.meta.carOrdinal,
      rows,
    );
  }

  private loadShiftHistory(carOrdinal: number): ShiftHistory {
    const history: ShiftHistory = {};
    for (const row of this.loadCarRows(SHIFT_HISTORY_FILE, carOrdinal)) {
      const gear = Number(row[2]);
      if (!history[gear]) history[gear] = [];
      history[gear].push({
        rpm: Number(row[3]),
        score: Number(row[4]),
        timestamp: new Date(row[5]).getTime(),
      });
    }
    return history;
  }
}
