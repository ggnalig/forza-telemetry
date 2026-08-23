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
import { SessionRecorder } from "../src/services/session-recorder";
import { SettingsStore } from "../src/services/settings-store";

const FH6_DASH_SIZE = 324;

// GearboxTuneStore/SessionRecorder both persist to disk - point every
// processor created in this file at a throwaway directory so tests never
// write into (or read stale data from) the real `data/` folder.
const testProfileDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "forza-pipeline-test-"),
);
after(() => fs.rmSync(testProfileDir, { recursive: true, force: true }));

function createTestProcessor(sessionRecorder?: SessionRecorder): TelemetryProcessor {
  return new TelemetryProcessor(
    false,
    new GearboxTuneStore(testProfileDir),
    // Short idle timeout/check interval by default so tests exercising
    // session finalization don't have to wait out the real 10s default.
    sessionRecorder ?? new SessionRecorder(testProfileDir, 100, 20),
    new SettingsStore(testProfileDir),
  );
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

// Raw gear byte encoding confirmed empirically against real FH6 telemetry
// (an earlier speed-sign-based hypothesis was tried and confirmed wrong
// live in-game - see the reverse_gear_fix memory): 0 = Reverse, 1-10 =
// forward gears, 11 = Neutral. The parser passes it through unchanged, no
// sentinel substitution.
test("parser passes raw gear 0 (Reverse) through unchanged", () => {
  const packet = buildPacket({ gear: 0 });
  const result = fh6TelemetryParser.parse(packet);
  assert.ok(result, "expected a valid packet to parse successfully");
  assert.equal(result!.parsed.input.gear, 0);
});

test("parser passes raw gear 11 (Neutral) through unchanged", () => {
  const packet = buildPacket({ gear: 11 });
  const result = fh6TelemetryParser.parse(packet);
  assert.ok(result, "expected a valid packet to parse successfully");
  assert.equal(result!.parsed.input.gear, 11);
});

test("parser normalizes negative speed to a positive magnitude rather than dropping the packet", () => {
  const packet = buildPacket({ speedMs: -12 });
  const result = fh6TelemetryParser.parse(packet);
  assert.ok(result, "expected a valid packet to parse successfully");
  assert.ok(Math.abs(result!.parsed.performance.speedKmh - 12 * 3.6) < 0.01);
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

// --- Session recording: manually toggled via setRecordingEnabled (the
// "Record" button's backing call - see session-recorder.ts's doc comment for
// why isRaceOn/lap.number turned out unusable for automatic detection),
// records frames tagged with the current build key while enabled, and is
// finalized either by an explicit stop or the idle-timeout safety net. ---

function driveSessionFrame(
  processor: TelemetryProcessor,
  carOrdinal: number,
  rpm = 4000,
) {
  const packet = buildPacket({ carOrdinal, rpm, gear: 3, throttle: 1 });
  const parsed = fh6TelemetryParser.parse(packet);
  assert.ok(parsed, "expected packet to parse during test drive");
  return processor.process(parsed!);
}

// Matches buildPacket's defaults (carClass 5, performanceIndex 700,
// drivetrain 1, numCylinders 6, maxRpm 8000) - lets tests filter
// listSessions() down to just their own carOrdinal instead of asserting on
// the full list, since the sqlite file is shared across every test in this
// file (each test's sessions otherwise accumulate in listSessions()).
function buildKeyFor(carOrdinal: number): string {
  return computeBuildKey({
    carOrdinal,
    carClass: 5,
    performanceIndex: 700,
    drivetrain: 1,
    numCylinders: 6,
    idleRpm: 800,
    maxRpm: 8000,
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("no session is recorded unless recording is explicitly enabled", () => {
  const recorder = new SessionRecorder(testProfileDir, 100, 20);
  const processor = createTestProcessor(recorder);
  const carOrdinal = 4000;

  driveSessionFrame(processor, carOrdinal, 4000);
  driveSessionFrame(processor, carOrdinal, 4500);

  assert.deepEqual(
    recorder.listSessions(buildKeyFor(carOrdinal)),
    [],
    "frames must not be recorded until setRecordingEnabled(true) is called",
  );
});

test("stopping recording immediately finalizes the session, without waiting for the idle timeout", () => {
  const recorder = new SessionRecorder(testProfileDir, 100, 20);
  const processor = createTestProcessor(recorder);
  const carOrdinal = 4007;

  recorder.setRecordingEnabled(true);
  for (let i = 0; i < 12; i++) driveSessionFrame(processor, carOrdinal);
  assert.equal(recorder.isRecording(), true);

  recorder.setRecordingEnabled(false);

  const [session] = recorder.listSessions(buildKeyFor(carOrdinal));
  assert.equal(recorder.isRecording(), false);
  assert.equal(session.status, "completed", "12 frames is enough to count as completed");
  assert.ok(session.endedAt !== null, "must be finalized immediately, not left pending for the idle timer");
});

test("a session starts on the first frame once recording is enabled, and records frames tagged with the current build key", () => {
  const recorder = new SessionRecorder(testProfileDir, 100, 20);
  const processor = createTestProcessor(recorder);
  const carOrdinal = 4001;

  recorder.setRecordingEnabled(true);
  driveSessionFrame(processor, carOrdinal, 4000);
  driveSessionFrame(processor, carOrdinal, 4500);

  const sessions = recorder.listSessions(buildKeyFor(carOrdinal));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].status, "recording");
  assert.equal(sessions[0].carOrdinal, carOrdinal);
  assert.equal(sessions[0].frameCount, 2);

  const frames = recorder.getFrames(sessions[0].id);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].rpm, 4000);
  assert.equal(frames[1].rpm, 4500);
});

test("a session with enough frames is marked 'completed' once it goes idle", async () => {
  const recorder = new SessionRecorder(testProfileDir, 100, 20);
  const processor = createTestProcessor(recorder);
  const carOrdinal = 4002;

  recorder.setRecordingEnabled(true);
  for (let i = 0; i < 12; i++) {
    driveSessionFrame(processor, carOrdinal);
  }

  await wait(200); // past the 100ms idle timeout, checked every 20ms

  const sessions = recorder.listSessions(buildKeyFor(carOrdinal));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].status, "completed");
  assert.ok(sessions[0].endedAt !== null);
});

test("a session with too few frames is marked 'aborted' once it goes idle", async () => {
  const recorder = new SessionRecorder(testProfileDir, 100, 20);
  const processor = createTestProcessor(recorder);
  const carOrdinal = 4003;

  recorder.setRecordingEnabled(true);
  driveSessionFrame(processor, carOrdinal);

  await wait(200);

  const sessions = recorder.listSessions(buildKeyFor(carOrdinal));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].status, "aborted");
});

test("switching to a different build finalizes the old session before the new one starts", () => {
  const recorder = new SessionRecorder(testProfileDir, 100, 20);
  const processor = createTestProcessor(recorder);

  recorder.setRecordingEnabled(true);
  driveSessionFrame(processor, 4004);
  driveSessionFrame(processor, 4004);

  // A different car.ordinal (and therefore a different build key) mid-drive.
  driveSessionFrame(processor, 4005);

  const [carA] = recorder.listSessions(buildKeyFor(4004));
  const [carB] = recorder.listSessions(buildKeyFor(4005));
  assert.ok(carA, "expected car A to have its own session");
  assert.ok(carB, "expected car B to have its own session");
  assert.equal(carA.status, "aborted", "car A's session had too few frames (2)");
  assert.notEqual(
    carA.buildKey,
    carB.buildKey,
    "different car.ordinal must produce a different build key",
  );
});

test("deleteSession removes a session and its frames", () => {
  const recorder = new SessionRecorder(testProfileDir, 100, 20);
  const processor = createTestProcessor(recorder);

  recorder.setRecordingEnabled(true);
  driveSessionFrame(processor, 4006);
  const [session] = recorder.listSessions(buildKeyFor(4006));
  assert.ok(session);

  const deleted = recorder.deleteSession(session.id);
  assert.equal(deleted, true);
  assert.equal(recorder.getSession(session.id), null);
  assert.deepEqual(recorder.getFrames(session.id), []);
});

// --- GearboxTune manual RPM overrides: round-trip through the CSV store,
// and actually applied live by TelemetryProcessor when the tune is active
// (see computeEffectiveRpm) - mirrors the manual-correction escape hatch
// SimHub offers for cars whose reported max RPM isn't trustworthy. ---

test("GearboxTuneStore round-trips maxRpmOverride/maxRpmPerGearOverride/redlineOverride/shiftLightPercents", () => {
  const store = new GearboxTuneStore(testProfileDir);
  const tune = store.createTune(5001, "Test Tune", { 1: 3.5, 2: 2.1 }, {
    maxRpmOverride: 9000,
    maxRpmPerGearOverride: { 1: 8500 },
    redlineOverride: 8800,
    shiftLightPercents: { light1: 0.85, light2: 0.92, redline: 0.94 },
  });

  const loaded = store.getTune(tune.id);
  assert.deepEqual(loaded, tune);
  assert.equal(loaded?.maxRpmOverride, 9000);
  assert.deepEqual(loaded?.maxRpmPerGearOverride, { 1: 8500 });
  assert.equal(loaded?.redlineOverride, 8800);
  assert.deepEqual(loaded?.shiftLightPercents, { light1: 0.85, light2: 0.92, redline: 0.94 });

  // A tune with no overrides at all should round-trip with them all absent,
  // not present-as-zero/present-as-empty-object.
  const plain = store.createTune(5002, "Plain Tune", { 1: 3.0 });
  const loadedPlain = store.getTune(plain.id);
  assert.equal(loadedPlain?.maxRpmOverride, undefined);
  assert.equal(loadedPlain?.maxRpmPerGearOverride, undefined);
  assert.equal(loadedPlain?.redlineOverride, undefined);
  assert.equal(loadedPlain?.shiftLightPercents, undefined);
});

test("updateTune only touches override fields actually present in the update", () => {
  const store = new GearboxTuneStore(testProfileDir);
  const tune = store.createTune(5003, "Test Tune", { 1: 3.5 }, {
    maxRpmOverride: 9000,
    redlineOverride: 8800,
  });

  const updated = store.updateTune(tune.id, { name: "Renamed" });
  assert.equal(updated?.maxRpmOverride, 9000, "an update that doesn't mention maxRpmOverride must leave it untouched");
  assert.equal(updated?.redlineOverride, 8800);
  assert.equal(updated?.name, "Renamed");

  const cleared = store.updateTune(tune.id, { maxRpmOverride: undefined });
  assert.equal(cleared?.maxRpmOverride, undefined, "explicitly setting a field to undefined must clear it");
  assert.equal(cleared?.redlineOverride, 8800, "fields not mentioned in this update must still be untouched");
});

test("an active tune's RPM overrides are applied live, falling back to defaults", () => {
  const tuneStore = new GearboxTuneStore(testProfileDir);
  const recorder = new SessionRecorder(testProfileDir, 100, 20);
  const processor = new TelemetryProcessor(false, tuneStore, recorder, new SettingsStore(testProfileDir));
  const carOrdinal = 5004;

  const tune = tuneStore.createTune(carOrdinal, "Overridden", { 1: 3.5 }, {
    maxRpmOverride: 9000,
    maxRpmPerGearOverride: { 3: 8500 },
    redlineOverride: 8800,
    shiftLightPercents: { light1: 0.85, light2: 0.92, redline: 0.94 },
  });
  tuneStore.setActiveTune(carOrdinal, tune.id);

  const drive = (gear: number) => {
    const packet = buildPacket({ carOrdinal, gear, rpm: 4000, maxRpm: 8000 });
    const parsed = fh6TelemetryParser.parse(packet);
    return processor.process(parsed!);
  };

  // Gear 2 has no per-gear override, so maxRpmOverride (9000) applies.
  let result = drive(2);
  assert.equal(result.diagnostics.effectiveMaxRpm, 9000);
  assert.equal(result.diagnostics.effectiveRedline, 8800, "redlineOverride wins over effective max RPM");
  assert.deepEqual(result.diagnostics.shiftLightPercents, { light1: 0.85, light2: 0.92, redline: 0.94 });

  // Gear 3 has its own per-gear override (8500), which wins over maxRpmOverride.
  result = drive(3);
  assert.equal(result.diagnostics.effectiveMaxRpm, 8500);

  // A car with no active tune falls back to the game's own maxRpm and the
  // library-wide shift-light defaults.
  const untunedResult = (() => {
    const packet = buildPacket({ carOrdinal: 5005, gear: 2, rpm: 4000, maxRpm: 7500 });
    return processor.process(fh6TelemetryParser.parse(packet)!);
  })();
  assert.equal(untunedResult.diagnostics.effectiveMaxRpm, 7500);
  assert.equal(untunedResult.diagnostics.effectiveRedline, 7500);
  assert.deepEqual(
    untunedResult.diagnostics.shiftLightPercents,
    new SettingsStore(testProfileDir).getGeneralSettings().shiftLightPercents,
  );
});

test("maxRpmPerGearOverride's key 0 is a combined N/R bucket - applies to both Reverse (raw gear 0) and Neutral (raw gear 11)", () => {
  const tuneStore = new GearboxTuneStore(testProfileDir);
  const recorder = new SessionRecorder(testProfileDir, 100, 20);
  const processor = new TelemetryProcessor(false, tuneStore, recorder, new SettingsStore(testProfileDir));
  const carOrdinal = 5007;

  const tune = tuneStore.createTune(carOrdinal, "N/R bucket test", { 1: 3.5 }, {
    maxRpmOverride: 9000,
    maxRpmPerGearOverride: { 0: 6000 },
  });
  tuneStore.setActiveTune(carOrdinal, tune.id);

  const reversePacket = buildPacket({ carOrdinal, gear: 0, rpm: 4000, maxRpm: 8000 });
  const reverseResult = processor.process(fh6TelemetryParser.parse(reversePacket)!);
  assert.equal(reverseResult.diagnostics.effectiveMaxRpm, 6000);

  const neutralPacket = buildPacket({ carOrdinal, gear: 11, rpm: 4000, maxRpm: 8000 });
  const neutralResult = processor.process(fh6TelemetryParser.parse(neutralPacket)!);
  assert.equal(neutralResult.diagnostics.effectiveMaxRpm, 6000);
});

test("analyzeByBuildKey aggregates observed WOT rpm overall and per gear across sessions", () => {
  const recorder = new SessionRecorder(testProfileDir, 100, 20);
  const processor = createTestProcessor(recorder);
  const carOrdinal = 5006;
  const buildKey = buildKeyFor(carOrdinal);

  const drive = (gear: number, rpm: number, throttle: number) => {
    const packet = buildPacket({ carOrdinal, gear, rpm, throttle });
    const parsed = fh6TelemetryParser.parse(packet);
    return processor.process(parsed!);
  };

  recorder.setRecordingEnabled(true);
  drive(2, 6000, 1); // WOT
  drive(2, 6500, 1); // WOT, new gear-2 max
  drive(2, 9000, 0.3); // NOT WOT - must be ignored
  drive(3, 7200, 1); // WOT, gear 3

  const report = recorder.analyzeByBuildKey(buildKey);
  assert.ok(report);
  assert.equal(report?.carOrdinal, carOrdinal);
  assert.equal(report?.sessionCount, 1);
  assert.equal(report?.wotFrameCount, 3, "the partial-throttle frame must not count");
  assert.equal(report?.observedMaxRpmOverall, 7200);
  assert.deepEqual(report?.observedMaxRpmPerGear, { 2: 6500, 3: 7200 });
  assert.equal(report?.suggestedShiftLightRpm["90%"], Math.round(7200 * 0.9));
  assert.equal(report?.suggestedShiftLightRpm["96%"], Math.round(7200 * 0.96));

  assert.equal(
    recorder.analyzeByBuildKey("nonexistent:build:key:1"),
    null,
    "a build with no recorded sessions must return null, not an empty report",
  );
});

// --- SettingsStore: the persisted "General settings" default (SimHub's own
// tab equivalent) - seeds from a bootstrap constant on first read, persists
// whatever the user sets afterward, and is what TelemetryProcessor falls
// back to when a tune has no shiftLightPercents of its own. ---

test("SettingsStore seeds bootstrap defaults on first read, then persists whatever is set", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forza-settings-test-"));
  try {
    const store = new SettingsStore(dir);
    const seeded = store.getGeneralSettings();
    assert.deepEqual(seeded, { shiftLightPercents: { light1: 0.9, light2: 0.95, redline: 0.96 } });

    store.setGeneralSettings({ shiftLightPercents: { light1: 0.8, light2: 0.88, redline: 0.93 } });

    // A fresh instance pointed at the same directory must see the persisted
    // value, not the bootstrap default - proves it actually wrote to disk.
    const reloaded = new SettingsStore(dir).getGeneralSettings();
    assert.deepEqual(reloaded, { shiftLightPercents: { light1: 0.8, light2: 0.88, redline: 0.93 } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a tune with no shiftLightPercents falls back to SettingsStore's persisted general default, not a hardcoded one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forza-settings-fallback-test-"));
  try {
    const settingsStore = new SettingsStore(dir);
    settingsStore.setGeneralSettings({
      shiftLightPercents: { light1: 0.7, light2: 0.8, redline: 0.9 },
    });

    const tuneStore = new GearboxTuneStore(dir);
    const recorder = new SessionRecorder(dir, 100, 20);
    const processor = new TelemetryProcessor(false, tuneStore, recorder, settingsStore);
    const carOrdinal = 5007;

    // No tune active at all for this car - must use the custom general default.
    const packet = buildPacket({ carOrdinal, gear: 2, rpm: 4000, maxRpm: 8000 });
    const result = processor.process(fh6TelemetryParser.parse(packet)!);
    assert.deepEqual(result.diagnostics.shiftLightPercents, { light1: 0.7, light2: 0.8, redline: 0.9 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- GearboxTuneStore.listAllTunes: the Car Settings tree's data source -
// every tune across every car, not scoped to one carOrdinal like listTunes. ---

test("listAllTunes returns tunes across multiple car ordinals", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forza-list-all-tunes-test-"));
  try {
    const store = new GearboxTuneStore(dir);
    store.createTune(6001, "Tune A", { 1: 3.0 });
    store.createTune(6001, "Tune B", { 1: 3.2 });
    store.createTune(6002, "Tune C", { 1: 2.8 });

    const all = store.listAllTunes();
    assert.equal(all.length, 3);
    assert.deepEqual(
      all.map((t) => t.carOrdinal).sort(),
      [6001, 6001, 6002],
    );
    assert.deepEqual(
      all.map((t) => t.name).sort(),
      ["Tune A", "Tune B", "Tune C"],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
