// Persists learned per-car shift/gearing state as a small CSV "database" -
// one file per table, keyed by a composite "build key" (not just
// `car.ordinal`), so switching back to a car you've already driven warm-starts
// the model instead of relearning it from scratch every session. CSV (not
// JSON) is deliberate: every file is directly openable/plottable in a
// spreadsheet for inspecting or tuning the learned model by hand.
//
// Why not just `car.ordinal`: Forza reuses the same ordinal for every
// instance of a given car model, so two owned copies of "the same car" with
// different builds (engine swap, drivetrain conversion, cam upgrade shifting
// the redline) would otherwise collide and corrupt each other's learned
// profile. The composite key (ordinal + numCylinders + maxRpm + drivetrain)
// catches the most structurally-different-engine cases. It deliberately does
// NOT include performanceIndex/carClass - those shift with tire/aero/weight
// changes that don't affect gearing or the power curve at all, and would
// cause spurious "new car" resets. It also can't catch every build
// difference (a turbo swap or a manual gear ratio retune with the same
// engine/redline/drivetrain is invisible to this key) - see
// audit-result/audit.md for the follow-up idea (comparing freshly-observed
// gear ratios/power against the loaded profile) that would close that gap.
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

/**
 * Identifies a specific build of a car, not just the model. Two owned copies
 * of the same `car.ordinal` with a different engine (numCylinders), a
 * cam/internals upgrade that shifted the redline (maxRpm), or a drivetrain
 * conversion get distinct keys and therefore distinct learned profiles.
 * `maxRpm` is rounded before joining so float noise can't split one build
 * into two keys.
 */
export function computeBuildKey(meta: CarMeta): string {
  return `${meta.carOrdinal}:${meta.numCylinders}:${Math.round(meta.maxRpm)}:${meta.drivetrain}`;
}

const CARS_FILE = "cars.csv";
const GEAR_RATIOS_FILE = "gear_ratios.csv";
const GEAR_EFFICIENCY_FILE = "gear_efficiency.csv";
const POWER_CURVE_FILE = "power_curve.csv";
const SHIFT_HISTORY_FILE = "shift_history.csv";

const CARS_HEADERS = [
  "build_key",
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
  "build_key",
  "car_ordinal",
  "car_class",
  "gear",
  "ratio_median",
  "ratio_sample_count",
];

const GEAR_EFFICIENCY_HEADERS = [
  "build_key",
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

const POWER_CURVE_HEADERS = [
  "build_key",
  "car_ordinal",
  "car_class",
  "rpm_bucket",
  "power_kw",
];

const SHIFT_HISTORY_HEADERS = [
  "build_key",
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

/** Every field in this store is numeric, a string with no commas (the build
 * key), or an ISO timestamp - no commas or quotes ever appear in a value, so
 * a hand-rolled CSV reader/writer is safe and avoids pulling in a parsing
 * dependency for a five-file hobby dataset. */
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
    const buildKey = computeBuildKey(profile.meta);
    try {
      this.saveCars(buildKey, profile);
      this.saveGearRatios(buildKey, profile);
      this.saveGearEfficiency(buildKey, profile);
      this.savePowerCurve(buildKey, profile);
      this.saveShiftHistory(buildKey, profile);
    } catch (error) {
      console.error(`⚠️  Failed to save car profile for build ${buildKey}:`, error);
    }
  }

  load(meta: CarMeta): CarProfile | null {
    const buildKey = computeBuildKey(meta);
    try {
      const savedMeta = this.loadCarMeta(buildKey);
      if (!savedMeta) return null;

      return {
        meta: savedMeta,
        gearRatios: this.loadGearRatios(buildKey),
        gearEfficiency: this.loadGearEfficiency(buildKey),
        powerCurve: this.loadPowerCurve(buildKey),
        shiftHistory: this.loadShiftHistory(buildKey),
      };
    } catch (error) {
      console.error(`⚠️  Failed to load car profile for build ${buildKey}:`, error);
      return null;
    }
  }

  private filePath(fileName: string): string {
    return path.join(this.baseDir, fileName);
  }

  /** Drops any existing rows for this build (column 0 is always build_key) and appends the new ones. */
  private replaceBuildRows(
    fileName: string,
    headers: string[],
    buildKey: string,
    newRows: (string | number)[][],
  ): void {
    const filePath = this.filePath(fileName);
    const keptRows = readCsvRows(filePath).filter((row) => row[0] !== buildKey);
    writeCsvRows(filePath, headers, [...keptRows, ...newRows]);
  }

  private loadBuildRows(fileName: string, buildKey: string): string[][] {
    return readCsvRows(this.filePath(fileName)).filter(
      (row) => row[0] === buildKey,
    );
  }

  // ---- cars.csv ----

  private saveCars(buildKey: string, profile: CarProfile): void {
    const { meta } = profile;
    const row = [
      buildKey,
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
    this.replaceBuildRows(CARS_FILE, CARS_HEADERS, buildKey, [row]);
  }

  private loadCarMeta(buildKey: string): CarMeta | null {
    const [row] = this.loadBuildRows(CARS_FILE, buildKey);
    if (!row) return null;

    return {
      carOrdinal: Number(row[1]),
      carClass: Number(row[2]),
      performanceIndex: Number(row[3]),
      drivetrain: Number(row[4]),
      numCylinders: Number(row[5]),
      idleRpm: Number(row[6]),
      maxRpm: Number(row[7]),
    };
  }

  private getTotalWotSamples(buildKey: string): number {
    const [row] = this.loadBuildRows(CARS_FILE, buildKey);
    return row ? Number(row[9]) : 0;
  }

  // ---- gear_ratios.csv ----

  private saveGearRatios(buildKey: string, profile: CarProfile): void {
    const rows = Object.entries(profile.gearRatios).map(([gear, summary]) => [
      buildKey,
      profile.meta.carOrdinal,
      profile.meta.carClass,
      Number(gear),
      round(summary.ratioMedian, 3),
      summary.sampleCount,
    ]);
    this.replaceBuildRows(GEAR_RATIOS_FILE, GEAR_RATIOS_HEADERS, buildKey, rows);
  }

  private loadGearRatios(buildKey: string): GearRatioSummary {
    const summary: GearRatioSummary = {};
    for (const row of this.loadBuildRows(GEAR_RATIOS_FILE, buildKey)) {
      summary[Number(row[3])] = {
        ratioMedian: Number(row[4]),
        sampleCount: Number(row[5]),
      };
    }
    return summary;
  }

  // ---- gear_efficiency.csv ----

  private saveGearEfficiency(buildKey: string, profile: CarProfile): void {
    const rows = Object.entries(profile.gearEfficiency).map(([gear, s]) => [
      buildKey,
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
    this.replaceBuildRows(
      GEAR_EFFICIENCY_FILE,
      GEAR_EFFICIENCY_HEADERS,
      buildKey,
      rows,
    );
  }

  private loadGearEfficiency(buildKey: string): GearEfficiencySummary {
    const summary: GearEfficiencySummary = {};
    for (const row of this.loadBuildRows(GEAR_EFFICIENCY_FILE, buildKey)) {
      summary[Number(row[3])] = {
        rpmMin: Number(row[4]),
        rpmMax: Number(row[5]),
        rpmAvg: Number(row[6]),
        rpmOptimal: Number(row[7]),
        observedRpmLow: Number(row[8]),
        observedRpmHigh: Number(row[9]),
        wotSampleCount: Number(row[10]),
        totalSampleCount: Number(row[11]),
      };
    }
    return summary;
  }

  // ---- power_curve.csv ----

  private savePowerCurve(buildKey: string, profile: CarProfile): void {
    const rows = Object.entries(profile.powerCurve.powerByRpmBucket).map(
      ([bucket, power]) => [
        buildKey,
        profile.meta.carOrdinal,
        profile.meta.carClass,
        Number(bucket),
        round(power, 1),
      ],
    );
    this.replaceBuildRows(POWER_CURVE_FILE, POWER_CURVE_HEADERS, buildKey, rows);
  }

  /** sampleCount isn't per-bucket, so it's carried in cars.csv's total_wot_samples column. */
  private loadPowerCurve(
    buildKey: string,
  ): ReturnType<EnginePowerCurve["exportState"]> {
    const powerByRpmBucket: { [rpmBucket: number]: number } = {};
    for (const row of this.loadBuildRows(POWER_CURVE_FILE, buildKey)) {
      powerByRpmBucket[Number(row[3])] = Number(row[4]);
    }
    return {
      powerByRpmBucket,
      sampleCount: this.getTotalWotSamples(buildKey),
    };
  }

  // ---- shift_history.csv ----

  private saveShiftHistory(buildKey: string, profile: CarProfile): void {
    const rows: (string | number)[][] = [];
    for (const [gear, outcomes] of Object.entries(profile.shiftHistory)) {
      for (const outcome of outcomes) {
        rows.push([
          buildKey,
          profile.meta.carOrdinal,
          profile.meta.carClass,
          Number(gear),
          Math.round(outcome.rpm),
          round(outcome.score, 1),
          new Date(outcome.timestamp).toISOString(),
        ]);
      }
    }
    this.replaceBuildRows(
      SHIFT_HISTORY_FILE,
      SHIFT_HISTORY_HEADERS,
      buildKey,
      rows,
    );
  }

  private loadShiftHistory(buildKey: string): ShiftHistory {
    const history: ShiftHistory = {};
    for (const row of this.loadBuildRows(SHIFT_HISTORY_FILE, buildKey)) {
      const gear = Number(row[3]);
      if (!history[gear]) history[gear] = [];
      history[gear].push({
        rpm: Number(row[4]),
        score: Number(row[5]),
        timestamp: new Date(row[6]).getTime(),
      });
    }
    return history;
  }
}
