// Single integration test covering the whole telemetry pipeline end to end:
// raw 331-byte UDP buffer -> CarDash331Parser -> TelemetryProcessor -> shift
// recommendations, plus the per-car persistence layer.
//
// This intentionally replaces the pile of ad-hoc test-*.js scripts that used
// to live in the repo root: one file, one thing to keep in sync with the
// pipeline's actual shape.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { carDash331Parser } from "../src/udp/parser";
import { TelemetryProcessor } from "../src/telemetry/processor";
import { CarProfileStore } from "../src/services/car-profile-store";

const CAR_DASH_SIZE = 331;

// TelemetryProcessor persists learned state to disk on a car change - point
// every processor created in this file at a throwaway directory so tests
// never write into (or read stale data from) the real `data/` folder.
const testProfileDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "forza-pipeline-test-"),
);
after(() => fs.rmSync(testProfileDir, { recursive: true, force: true }));

function createTestProcessor(): TelemetryProcessor {
  return new TelemetryProcessor(false, new CarProfileStore(testProfileDir));
}

const OFFSETS = {
  isRaceOn: 0,
  timestampMS: 4,
  engineMaxRpm: 8,
  engineIdleRpm: 12,
  currentEngineRpm: 16,
  // motion/suspension/slip block (20-211): left at zero for every test packet
  carOrdinal: 212,
  carClass: 216,
  carPerformanceIndex: 220,
  drivetrainType: 224,
  numCylinders: 228,
  positionX: 232,
  speed: 244,
  power: 248,
  torque: 252,
  tireTempFL: 256,
  tireTempFR: 260,
  tireTempRL: 264,
  tireTempRR: 268,
  boost: 272,
  fuel: 276,
  distanceTraveled: 280,
  bestLap: 284,
  lastLap: 288,
  currentLap: 292,
  currentRaceTime: 296,
  lapNumber: 300,
  racePosition: 302,
  accel: 303,
  brake: 304,
  clutch: 305,
  handbrake: 306,
  gear: 307,
  steer: 308,
  normalizedDrivingLine: 309,
  normalizedAIBrakeDifference: 310,
  tireWearFL: 311,
  trackOrdinal: 327,
} as const;

interface PacketFields {
  isRaceOn?: number;
  rpm?: number;
  maxRpm?: number;
  idleRpm?: number;
  carOrdinal?: number;
  numCylinders?: number;
  speedMs?: number;
  powerWatts?: number;
  torqueNm?: number;
  fuel?: number;
  lapNumber?: number;
  throttle?: number;
  gear?: number;
}

/** Builds a syntactically valid 331-byte Car Dash packet for the parser. */
function buildPacket(fields: PacketFields = {}): Buffer {
  const buf = Buffer.alloc(CAR_DASH_SIZE);

  buf.writeInt32LE(fields.isRaceOn ?? 1, OFFSETS.isRaceOn);
  buf.writeUInt32LE(Date.now() >>> 0, OFFSETS.timestampMS);
  buf.writeFloatLE(fields.maxRpm ?? 8000, OFFSETS.engineMaxRpm);
  buf.writeFloatLE(fields.idleRpm ?? 800, OFFSETS.engineIdleRpm);
  buf.writeFloatLE(fields.rpm ?? 3000, OFFSETS.currentEngineRpm);

  buf.writeInt32LE(fields.carOrdinal ?? 100, OFFSETS.carOrdinal);
  buf.writeInt32LE(5, OFFSETS.carClass);
  buf.writeInt32LE(700, OFFSETS.carPerformanceIndex);
  buf.writeInt32LE(1, OFFSETS.drivetrainType);
  buf.writeInt32LE(fields.numCylinders ?? 6, OFFSETS.numCylinders);

  buf.writeFloatLE(fields.speedMs ?? 30, OFFSETS.speed);
  buf.writeFloatLE(fields.powerWatts ?? 200000, OFFSETS.power);
  buf.writeFloatLE(fields.torqueNm ?? 400, OFFSETS.torque);

  buf.writeFloatLE(80, OFFSETS.tireTempFL);
  buf.writeFloatLE(80, OFFSETS.tireTempFR);
  buf.writeFloatLE(80, OFFSETS.tireTempRL);
  buf.writeFloatLE(80, OFFSETS.tireTempRR);

  buf.writeFloatLE(0, OFFSETS.boost);
  buf.writeFloatLE((fields.fuel ?? 80) / 100, OFFSETS.fuel);
  buf.writeFloatLE(1000, OFFSETS.distanceTraveled);

  buf.writeUInt16LE(fields.lapNumber ?? 1, OFFSETS.lapNumber);
  buf.writeUInt8(1, OFFSETS.racePosition);
  buf.writeUInt8(
    Math.round((fields.throttle ?? 1) * 255),
    OFFSETS.accel,
  );
  buf.writeUInt8(0, OFFSETS.brake);
  buf.writeUInt8(0, OFFSETS.clutch);
  buf.writeUInt8(0, OFFSETS.handbrake);
  buf.writeUInt8(fields.gear ?? 1, OFFSETS.gear);
  buf.writeInt8(0, OFFSETS.steer);
  buf.writeInt8(0, OFFSETS.normalizedDrivingLine);
  buf.writeInt8(0, OFFSETS.normalizedAIBrakeDifference);

  buf.writeInt32LE(1, OFFSETS.trackOrdinal);

  return buf;
}

test("parser rejects packets that aren't exactly 331 bytes", () => {
  const tooShort = Buffer.alloc(200);
  assert.equal(carDash331Parser.parse(tooShort), null);
});

test("parser rejects packets where isRaceOn is 0", () => {
  const notRacing = buildPacket({ isRaceOn: 0 });
  assert.equal(carDash331Parser.parse(notRacing), null);
});

test("parser decodes a valid 331-byte packet correctly", () => {
  const packet = buildPacket({
    rpm: 5500,
    maxRpm: 9000,
    idleRpm: 850,
    carOrdinal: 42,
    speedMs: 50,
    powerWatts: 150000,
    torqueNm: 350,
    gear: 3,
    lapNumber: 2,
  });

  const result = carDash331Parser.parse(packet);
  assert.ok(result, "expected a valid packet to parse successfully");

  const { parsed } = result!;
  assert.equal(parsed.engine.rpm, 5500);
  assert.equal(parsed.engine.maxRpm, 9000);
  assert.equal(parsed.car.ordinal, 42);
  assert.equal(parsed.input.gear, 3);
  // speed comes in m/s and is converted to km/h (* 3.6)
  assert.ok(Math.abs(parsed.performance.speedKmh - 50 * 3.6) < 0.01);
  // power comes in Watts and is converted to kW (/ 1000)
  assert.ok(Math.abs(parsed.performance.powerKw - 150) < 0.01);
  // lap number from telemetry is 0-indexed, parser adds 1
  assert.equal(parsed.lap.number, 3);
});

/** Runs `count` WOT frames through the full pipeline for one gear, sweeping rpm upward. */
function driveGearAtWOT(
  processor: TelemetryProcessor,
  gear: number,
  rpmStart: number,
  rpmStep: number,
  count: number,
  ratioRpmPerKmh: number,
  carOrdinal: number,
  maxRpm: number,
) {
  let result;
  for (let i = 0; i < count; i++) {
    const rpm = rpmStart + i * rpmStep;
    const speedMs = rpm / ratioRpmPerKmh / 3.6;
    const packet = buildPacket({
      rpm,
      maxRpm,
      idleRpm: 800,
      carOrdinal,
      speedMs,
      powerWatts: (200 + Math.sin(i / 8) * 40) * 1000,
      torqueNm: 400,
      gear,
      throttle: 1,
    });
    const parsed = carDash331Parser.parse(packet);
    assert.ok(parsed, "expected packet to parse during test drive");
    result = processor.process(parsed!);
  }
  return result!;
}

test("full pipeline: gear 5 can recommend upshift to gear 6 (regression for the old off-by-one bug)", () => {
  const processor = createTestProcessor();
  const carOrdinal = 501;
  const maxRpm = 8000;

  // Establish empirical ratios: gear 5 ~= 30 rpm per km/h, gear 6 ~= 22 rpm per km/h.
  driveGearAtWOT(processor, 5, 5000, 60, 40, 30, carOrdinal, maxRpm);
  driveGearAtWOT(processor, 6, 4000, 60, 20, 22, carOrdinal, maxRpm);

  const nearRedline = buildPacket({
    rpm: 7600,
    maxRpm,
    idleRpm: 800,
    carOrdinal,
    speedMs: (7600 / 30) / 3.6,
    powerWatts: 260000,
    torqueNm: 400,
    gear: 5,
    throttle: 1,
  });
  const parsed = carDash331Parser.parse(nearRedline);
  const result = processor.process(parsed!);

  assert.equal(
    result.efficiency?.recommendations?.upshiftRecommended,
    true,
    "gear 5 near redline should be allowed to recommend an upshift to gear 6",
  );
});

test("switching car.ordinal resets learned state to a fresh bootstrap baseline", () => {
  const processor = createTestProcessor();

  // Drive car A enough to move its gear-5 shift point away from bootstrap.
  driveGearAtWOT(processor, 5, 5000, 60, 40, 30, /* carOrdinal */ 1, 8000);

  // Switch to a different car with a different redline.
  const newCarPacket = buildPacket({
    rpm: 3000,
    maxRpm: 9000,
    idleRpm: 900,
    carOrdinal: 2,
    numCylinders: 8,
    speedMs: 30,
    powerWatts: 200000,
    torqueNm: 400,
    gear: 5,
    throttle: 1,
  });
  const parsed = carDash331Parser.parse(newCarPacket);
  const result = processor.process(parsed!);

  const expectedBootstrap = 9000 * 0.92;
  assert.ok(
    Math.abs((result.efficiency?.finalShiftRPM ?? 0) - expectedBootstrap) < 1,
    `expected fresh bootstrap baseline (~${expectedBootstrap}) after car change, got ${result.efficiency?.finalShiftRPM}`,
  );
});

test("gearing safety clamp keeps rpm after shift above idle floor on a wide-ratio gearbox", () => {
  const processor = createTestProcessor();
  const carOrdinal = 9001;
  const maxRpm = 5000;
  const idleRpm = 700;

  // gear 1 ~= 60 rpm/kmh, gear 2 ~= 15 rpm/kmh: a big ratio drop, like a truck.
  driveGearAtWOT(processor, 1, 3000, 30, 40, 60, carOrdinal, maxRpm);
  driveGearAtWOT(processor, 2, 1200, 30, 10, 15, carOrdinal, maxRpm);

  const packet = buildPacket({
    rpm: 4200,
    maxRpm,
    idleRpm,
    carOrdinal,
    speedMs: (4200 / 60) / 3.6,
    powerWatts: 150000,
    torqueNm: 500,
    gear: 1,
    throttle: 1,
  });
  const parsed = carDash331Parser.parse(packet);
  const result = processor.process(parsed!);

  const shiftRpm = result.efficiency?.finalShiftRPM ?? 0;
  const rpmAfterShift = shiftRpm * (15 / 60);

  assert.ok(
    rpmAfterShift >= idleRpm + 300 - 50,
    `expected shift point to be pushed up so post-shift rpm (${rpmAfterShift}) stays near/above idle+margin`,
  );
});

test("downshift recommendation is suppressed if it would over-rev the lower gear", () => {
  const processor = createTestProcessor();
  const carOrdinal = 7001;
  const maxRpm = 8000;

  // gear 2 ~= 20 rpm/kmh, gear 1 ~= 45 rpm/kmh: downshifting near-redline in
  // gear 2 would send gear 1 well past its own redline.
  driveGearAtWOT(processor, 1, 4000, 60, 40, 45, carOrdinal, maxRpm);
  driveGearAtWOT(processor, 2, 3000, 60, 20, 20, carOrdinal, maxRpm);

  const packet = buildPacket({
    rpm: 3600, // low in gear 2's band, would normally suggest downshift
    maxRpm,
    idleRpm: 800,
    carOrdinal,
    speedMs: (3600 / 20) / 3.6,
    powerWatts: 150000,
    torqueNm: 350,
    gear: 2,
    throttle: 1,
  });
  const parsed = carDash331Parser.parse(packet);
  const result = processor.process(parsed!);

  const rpmAfterDownshift = 3600 * (45 / 20);
  assert.ok(
    rpmAfterDownshift > maxRpm,
    "test setup sanity check: this downshift should indeed over-rev gear 1",
  );
  assert.equal(
    result.efficiency?.recommendations?.downshiftRecommended,
    false,
    "downshift must not be recommended when it would bounce gear 1 off the rev limiter",
  );
});

test("CarProfileStore round-trips a saved profile through the CSV database", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forza-profile-test-"));
  try {
    const store = new CarProfileStore(tmpDir);
    const profile = {
      meta: {
        carOrdinal: 123,
        carClass: 5,
        performanceIndex: 700,
        drivetrain: 1,
        numCylinders: 6,
        idleRpm: 800,
        maxRpm: 8000,
      },
      gearRatios: { 1: { ratioMedian: 58.234, sampleCount: 30 } },
      gearEfficiency: {
        1: {
          rpmMin: 2200,
          rpmMax: 7800,
          rpmAvg: 5100,
          rpmOptimal: 7150,
          shiftWindowLow: 6800,
          shiftWindowHigh: 7500,
          wotSampleCount: 32,
          totalSampleCount: 80,
        },
      },
      powerCurve: { powerByRpmBucket: { 5000: 250.4 }, sampleCount: 12 },
      shiftHistory: { 1: [{ rpm: 7000, score: 120.5, timestamp: 1700000000000 }] },
    };

    store.save(profile);
    const loaded = store.load(123);

    assert.deepEqual(loaded, {
      ...profile,
      gearRatios: { 1: { ratioMedian: 58.234, sampleCount: 30 } }, // rounded to 3 decimals on save
    });
    assert.equal(store.load(999), null);

    // The whole point of CSV: every file should be a plain, spreadsheet-openable table.
    const carsCsv = fs.readFileSync(path.join(tmpDir, "cars.csv"), "utf-8");
    assert.match(carsCsv, /^car_ordinal,car_class,performance_index/);
    assert.match(carsCsv, /^123,5,700/m);

    const powerCurveCsv = fs.readFileSync(
      path.join(tmpDir, "power_curve.csv"),
      "utf-8",
    );
    assert.match(powerCurveCsv, /^car_ordinal,car_class,rpm_bucket,power_kw/);
    assert.match(powerCurveCsv, /^123,5,5000,250\.4/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
