// Integration test covering the telemetry pipeline end to end: raw 324-byte
// UDP buffer -> Fh6TelemetryParser -> TelemetryProcessor, plus the build-key
// identity helper.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { fh6TelemetryParser } from "../src/udp/parser";
import { TelemetryProcessor } from "../src/telemetry/processor";
import { computeBuildKey } from "../src/telemetry/car-meta";
import { GearboxTuneStore } from "../src/services/gearbox-tune-store";

const FH6_DASH_SIZE = 324;

// GearboxTuneStore persists to disk - point every processor created in this
// file at a throwaway directory so tests never write into (or read stale
// data from) the real `data/` folder.
const testProfileDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "forza-pipeline-test-"),
);
after(() => fs.rmSync(testProfileDir, { recursive: true, force: true }));

function createTestProcessor(): TelemetryProcessor {
  return new TelemetryProcessor(false, new GearboxTuneStore(testProfileDir));
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
  carGroup: 232,
  smashableVelDiff: 236,
  smashableMass: 240,
  positionX: 244,
  speed: 256,
  power: 260,
  torque: 264,
  tireTempFL: 268,
  tireTempFR: 272,
  tireTempRL: 276,
  tireTempRR: 280,
  boost: 284,
  fuel: 288,
  distanceTraveled: 292,
  bestLap: 296,
  lastLap: 300,
  currentLap: 304,
  currentRaceTime: 308,
  lapNumber: 312,
  racePosition: 314,
  accel: 315,
  brake: 316,
  clutch: 317,
  handbrake: 318,
  gear: 319,
  steer: 320,
  normalizedDrivingLine: 321,
  normalizedAIBrakeDifference: 322,
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
  brake?: number;
  gear?: number;
}

/** Builds a syntactically valid 324-byte FH6 Data Out packet for the parser. */
function buildPacket(fields: PacketFields = {}): Buffer {
  const buf = Buffer.alloc(FH6_DASH_SIZE);

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
  buf.writeUInt8(Math.round((fields.brake ?? 0) * 255), OFFSETS.brake);
  buf.writeUInt8(0, OFFSETS.clutch);
  buf.writeUInt8(0, OFFSETS.handbrake);
  buf.writeUInt8(fields.gear ?? 1, OFFSETS.gear);
  buf.writeInt8(0, OFFSETS.steer);
  buf.writeInt8(0, OFFSETS.normalizedDrivingLine);
  buf.writeInt8(0, OFFSETS.normalizedAIBrakeDifference);

  return buf;
}

test("parser rejects packets that aren't exactly 324 bytes", () => {
  const tooShort = Buffer.alloc(200);
  assert.equal(fh6TelemetryParser.parse(tooShort), null);
});

test("parser rejects packets where isRaceOn is 0", () => {
  const notRacing = buildPacket({ isRaceOn: 0 });
  assert.equal(fh6TelemetryParser.parse(notRacing), null);
});

test("parser decodes a valid 324-byte packet correctly", () => {
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

  const result = fh6TelemetryParser.parse(packet);
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

test("computeBuildKey joins ordinal/numCylinders/maxRpm/drivetrain, rounding maxRpm", () => {
  assert.equal(
    computeBuildKey({
      carOrdinal: 123,
      carClass: 5,
      performanceIndex: 700,
      drivetrain: 1,
      numCylinders: 6,
      idleRpm: 800,
      maxRpm: 7999.6,
    }),
    "123:6:8000:1",
  );
});

test("observedRpmCeiling tracks the highest WOT rpm seen and ignores non-WOT frames", () => {
  const processor = createTestProcessor();
  const carOrdinal = 700;

  const drive = (rpm: number, throttle: number) => {
    const packet = buildPacket({ rpm, maxRpm: 8000, carOrdinal, throttle, gear: 3 });
    const parsed = fh6TelemetryParser.parse(packet);
    return processor.process(parsed!);
  };

  let result = drive(3000, 1);
  assert.equal(result.diagnostics.observedRpmCeiling, 3000);

  // A higher rpm at partial throttle must NOT count - it's not a genuine
  // WOT pull, so it isn't representative of the engine's true ceiling.
  result = drive(7500, 0.5);
  assert.equal(
    result.diagnostics.observedRpmCeiling,
    3000,
    "partial-throttle frames must not raise the ceiling",
  );

  // A genuine WOT frame at a higher rpm raises it.
  result = drive(6000, 1);
  assert.equal(result.diagnostics.observedRpmCeiling, 6000);

  // A lower WOT rpm afterwards must not lower it back down - it's a ceiling,
  // not a rolling/latest value.
  result = drive(4000, 1);
  assert.equal(
    result.diagnostics.observedRpmCeiling,
    6000,
    "the ceiling must not decrease once raised",
  );
});

test("observedRpmCeiling resets when the car changes", () => {
  const processor = createTestProcessor();

  const drive = (carOrdinal: number, rpm: number) => {
    const packet = buildPacket({ rpm, maxRpm: 8000, carOrdinal, throttle: 1, gear: 3 });
    const parsed = fh6TelemetryParser.parse(packet);
    return processor.process(parsed!);
  };

  let result = drive(801, 7000);
  assert.equal(result.diagnostics.observedRpmCeiling, 7000);

  // Switching to a different car must not carry over the old ceiling.
  result = drive(802, 2000);
  assert.equal(
    result.diagnostics.observedRpmCeiling,
    2000,
    "a car change must reset the ceiling, not keep the previous car's value",
  );
});
