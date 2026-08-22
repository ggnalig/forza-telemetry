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
  brake?: number;
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
  buf.writeUInt8(Math.round((fields.brake ?? 0) * 255), OFFSETS.brake);
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

test("two different builds sharing the same car.ordinal (e.g. an engine swap) don't share a learned profile", () => {
  const processor = createTestProcessor();
  const sharedOrdinal = 9001;

  // Build A: stock, 6-cyl, 8000rpm redline. Drive gear 5 enough to move its
  // shift point well away from bootstrap.
  const buildAResult = driveGearAtWOT(
    processor,
    5,
    5000,
    60,
    40,
    30,
    sharedOrdinal,
    8000,
  );
  const buildAShiftRPM = buildAResult.efficiency?.finalShiftRPM ?? 0;
  assert.ok(
    Math.abs(buildAShiftRPM - 8000 * 0.92) > 50,
    "sanity check: build A should have learned something other than the plain bootstrap",
  );

  // Build B: same car.ordinal, but an engine swap changed numCylinders and
  // maxRpm. Should be treated as a completely different car, not a resume.
  const buildBPacket = buildPacket({
    rpm: 3000,
    maxRpm: 9000,
    idleRpm: 900,
    carOrdinal: sharedOrdinal,
    numCylinders: 8,
    speedMs: 30,
    powerWatts: 200000,
    gear: 5,
    throttle: 1,
  });
  const buildBParsed = carDash331Parser.parse(buildBPacket);
  const buildBResult = processor.process(buildBParsed!);
  const buildBExpectedBootstrap = 9000 * 0.92;
  assert.ok(
    Math.abs((buildBResult.efficiency?.finalShiftRPM ?? 0) - buildBExpectedBootstrap) < 1,
    `build B (different engine, same ordinal) should start from its own fresh bootstrap (~${buildBExpectedBootstrap}), got ${buildBResult.efficiency?.finalShiftRPM}`,
  );

  // Switch BACK to build A's exact spec (same ordinal, same numCylinders/maxRpm).
  // The saved profile isn't trusted immediately - it's held as a "pending"
  // candidate until a fresh gear-ratio reading confirms it, so this needs
  // enough frames (matching build A's known ratio of 30 rpm/kmh) to resolve
  // before the warm-start actually kicks in.
  const backToAResult = driveGearAtWOT(
    processor,
    5,
    5000,
    50,
    6,
    30,
    sharedOrdinal,
    8000,
  );
  assert.ok(
    Math.abs((backToAResult.efficiency?.finalShiftRPM ?? 0) - buildAShiftRPM) < 1,
    `switching back to build A's exact spec should restore its saved finalShiftRPM (~${buildAShiftRPM}), got ${backToAResult.efficiency?.finalShiftRPM} - build A and B must not have overwritten each other`,
  );
});

test("a saved profile matching the composite build key but with a different observed gear ratio is discarded, not trusted", () => {
  const processor = createTestProcessor();
  const ordinal = 9002;

  // Learn build A: gear 5 at ratio 30 rpm/kmh, moved well away from bootstrap.
  const buildAResult = driveGearAtWOT(processor, 5, 5000, 60, 40, 30, ordinal, 8000);
  const buildAShiftRPM = buildAResult.efficiency?.finalShiftRPM ?? 0;
  assert.ok(
    Math.abs(buildAShiftRPM - 8000 * 0.92) > 50,
    "sanity check: build A should have learned something other than the plain bootstrap",
  );

  // Force a save+reset by switching to a different car entirely, then switch
  // back to the exact same build key (ordinal/numCylinders/maxRpm/drivetrain) -
  // but this time drive gear 5 at a very different ratio (45 instead of 30),
  // as if a manual gear ratio retune happened without changing engine specs
  // (exactly the gap the composite key alone can't see).
  const otherCarPacket = buildPacket({
    rpm: 3000,
    maxRpm: 6000,
    idleRpm: 800,
    carOrdinal: 9999,
    speedMs: 30,
    powerWatts: 150000,
    gear: 3,
    throttle: 1,
  });
  processor.process(carDash331Parser.parse(otherCarPacket)!);

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(" "));
  };

  let mismatchResult;
  try {
    mismatchResult = driveGearAtWOT(processor, 5, 5000, 60, 6, 45, ordinal, 8000);
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(
    warnings.some((w) => w.includes("mismatch")),
    "expected a mismatch warning once the fresh gear-5 ratio (45) diverged from the saved one (30)",
  );
  assert.ok(
    Math.abs((mismatchResult.efficiency?.finalShiftRPM ?? 0) - buildAShiftRPM) > 50,
    `mismatched profile must not be imported - finalShiftRPM should not match build A's learned value (~${buildAShiftRPM}), got ${mismatchResult.efficiency?.finalShiftRPM}`,
  );
});

test("a saved profile for the FIRST car driven in a fresh process is still loaded (not skipped on the very first frame)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forza-first-car-test-"));
  try {
    const ordinal = 9004;

    // Session 1: learn something about this car, then persist (e.g. app shutdown).
    const store1 = new CarProfileStore(tmpDir);
    const processor1 = new TelemetryProcessor(false, store1);
    const learnedResult = driveGearAtWOT(processor1, 5, 5000, 60, 40, 30, ordinal, 8000);
    const learnedShiftRPM = learnedResult.efficiency?.finalShiftRPM ?? 0;
    assert.ok(
      Math.abs(learnedShiftRPM - 8000 * 0.92) > 50,
      "sanity check: session 1 should have learned something other than plain bootstrap",
    );
    processor1.persistCurrentCarProfile();

    // Session 2: a brand new TelemetryProcessor (simulating a fresh app
    // restart) pointed at the same on-disk store, seeing this exact car for
    // the very first time *this process* has run. lastBuildKey starts null -
    // the saved profile must still be found and (after a few matching
    // fresh samples resolve the layer-2 verification) warm-started from.
    const store2 = new CarProfileStore(tmpDir);
    const processor2 = new TelemetryProcessor(false, store2);
    const resumedResult = driveGearAtWOT(processor2, 5, 5000, 60, 6, 30, ordinal, 8000);
    const resumedShiftRPM = resumedResult.efficiency?.finalShiftRPM ?? 0;

    // Not an exact match: the 6th frame (fed after the saved profile resolves
    // and gets imported partway through this drive) adds one more real
    // sample on top of it, nudging the estimate slightly - this checks it
    // landed close to what was learned (and nowhere near a fresh bootstrap),
    // not byte-for-byte equality.
    assert.ok(
      Math.abs(resumedShiftRPM - learnedShiftRPM) < learnedShiftRPM * 0.1,
      `the first car driven in a fresh process should still warm-start close to its saved profile (~${learnedShiftRPM}), got ${resumedShiftRPM}`,
    );
    assert.ok(
      Math.abs(resumedShiftRPM - 8000 * 0.92) > 50,
      `should not have fallen back to a fresh bootstrap (~${8000 * 0.92}), got ${resumedShiftRPM}`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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

// --- Downshift: power-driven crossover, braking-driven band, and the
// hysteresis that switches between them without flapping ---

const DOWNSHIFT_IDLE_RPM = 800;
const DOWNSHIFT_MAX_RPM = 8000;
const DOWNSHIFT_PEAK_RPM = 3000;
const DOWNSHIFT_PEAK_POWER = 300; // kW

/** A "peaky" power curve: rises to a peak at 3000rpm, then falls off hard
 * toward redline - like a narrow-powerband engine. Gives both downshift
 * modes a real, non-trivial threshold to find instead of a flat curve. */
function peakyPowerKw(rpm: number): number {
  if (rpm <= DOWNSHIFT_PEAK_RPM) {
    return (
      (DOWNSHIFT_PEAK_POWER * (rpm - DOWNSHIFT_IDLE_RPM)) /
      (DOWNSHIFT_PEAK_RPM - DOWNSHIFT_IDLE_RPM)
    );
  }
  return (
    DOWNSHIFT_PEAK_POWER -
    (250 * (rpm - DOWNSHIFT_PEAK_RPM)) / (DOWNSHIFT_MAX_RPM - DOWNSHIFT_PEAK_RPM)
  );
}

function feedFrame(
  processor: TelemetryProcessor,
  gear: number,
  ratioRpmPerKmh: number,
  carOrdinal: number,
  rpm: number,
  throttle: number,
  brake = 0,
) {
  const packet = buildPacket({
    rpm,
    maxRpm: DOWNSHIFT_MAX_RPM,
    idleRpm: DOWNSHIFT_IDLE_RPM,
    carOrdinal,
    speedMs: rpm / ratioRpmPerKmh / 3.6,
    powerWatts: peakyPowerKw(rpm) * 1000,
    gear,
    throttle,
    brake,
  });
  const parsed = carDash331Parser.parse(packet);
  assert.ok(parsed, "expected packet to parse during test drive");
  return processor.process(parsed!);
}

/**
 * Gear 1 ratio 45 rpm/kmh, gear 2 ratio 30 rpm/kmh (ratioToPreviousGear(2) = 1.5).
 * Sweeps gear 1 across the full rev range at WOT to build the pooled power
 * curve + gear 1's ratio, then establishes gear 2's ratio at low throttle so
 * it doesn't also seed gear 2's own per-gear efficiency baseline (which would
 * otherwise interfere with the upshift/downshift comparison in these tests).
 */
function setupPeakyPowerCar(processor: TelemetryProcessor, carOrdinal: number) {
  for (let rpm = DOWNSHIFT_IDLE_RPM; rpm <= DOWNSHIFT_MAX_RPM; rpm += 100) {
    feedFrame(processor, 1, 45, carOrdinal, rpm, 1);
  }
  for (const rpm of [2000, 2100, 2200, 2300, 2400, 2500]) {
    feedFrame(processor, 2, 30, carOrdinal, rpm, 0.3);
  }
}

test("power-driven downshift recommends when a lower gear would give more power (crossover)", () => {
  const processor = createTestProcessor();
  const carOrdinal = 6001;
  setupPeakyPowerCar(processor, carOrdinal);

  // Below the crossover (~2600-2700rpm): gear 1 already makes more power here.
  const belowCrossover = feedFrame(processor, 2, 30, carOrdinal, 1800, 1, 0);
  assert.equal(
    belowCrossover.efficiency?.recommendations?.downshiftRecommended,
    true,
    "well below the power-curve crossover, downshift to gear 1 should be recommended",
  );

  // Comfortably above the crossover: gear 2 is still ahead on the power curve.
  const aboveCrossover = feedFrame(processor, 2, 30, carOrdinal, 5500, 1, 0);
  assert.equal(
    aboveCrossover.efficiency?.recommendations?.downshiftRecommended,
    false,
    "above the power-curve crossover, gear 2 is still favorable - no downshift",
  );
});

test("braking-driven downshift targets the powerband, not the power-crossover point", () => {
  const processor = createTestProcessor();
  const carOrdinal = 6002;
  setupPeakyPowerCar(processor, carOrdinal);

  // Well below the 70%-of-peak-power band (~2300-2340rpm): should downshift
  // to be ready to accelerate once back on throttle.
  const belowBand = feedFrame(processor, 2, 30, carOrdinal, 1500, 0.05, 0.8);
  assert.equal(
    belowBand.efficiency?.recommendations?.downshiftRecommended,
    true,
    "below the braking-mode target band, downshift should be recommended",
  );

  // Above the band: already in (or past) the productive part of the powerband.
  const aboveBand = feedFrame(processor, 2, 30, carOrdinal, 4000, 0.05, 0.8);
  assert.equal(
    aboveBand.efficiency?.recommendations?.downshiftRecommended,
    false,
    "above the braking-mode target band, no downshift needed",
  );
});

test("downshift mode switching has hysteresis and doesn't flap during trail-braking", () => {
  const processor = createTestProcessor();
  const carOrdinal = 6003;
  setupPeakyPowerCar(processor, carOrdinal);

  // rpm=2450 sits between the two modes' thresholds (power-crossover ~2600-2700,
  // braking-band-low ~2300-2340), so the two modes disagree here - perfect for
  // proving which mode is actually active at each step.
  const rpm = 2450;

  const powerMode = feedFrame(processor, 2, 30, carOrdinal, rpm, 1, 0);
  assert.equal(
    powerMode.efficiency?.recommendations?.downshiftRecommended,
    true,
    "start in power mode: rpm 2450 is below the power-crossover, so downshift",
  );

  const enterBraking = feedFrame(processor, 2, 30, carOrdinal, rpm, 0.05, 0.8);
  assert.equal(
    enterBraking.efficiency?.recommendations?.downshiftRecommended,
    false,
    "throttle<0.15 & brake>0.5 enters braking mode: rpm 2450 is above its band-low, so hold",
  );

  const trailThrottleBlip = feedFrame(processor, 2, 30, carOrdinal, rpm, 0.25, 0);
  assert.equal(
    trailThrottleBlip.efficiency?.recommendations?.downshiftRecommended,
    false,
    "throttle 0.25 is above the enter-threshold but below the exit-threshold (0.35) - " +
      "hysteresis should keep it in braking mode, not flap back to power mode",
  );

  const throttleRecovers = feedFrame(processor, 2, 30, carOrdinal, rpm, 0.4, 0);
  assert.equal(
    throttleRecovers.efficiency?.recommendations?.downshiftRecommended,
    true,
    "throttle >= 0.35 clears the exit threshold: back to power mode, downshift again",
  );
});

// --- Shift light bar: default off, green/yellow fill bar while approaching,
// then the whole bar blinks orange exactly at the upshift trigger and blinks
// red once past it. Mirrors the private constants in ShiftEngine
// (LIGHT_APPROACH_RANGE_RATIO=0.15, LIGHT_BLINK_ZONE_WIDTH_RATIO=0.04,
// LIGHT_GREEN_POSITIONS=5) so the test can compute exact expected rpm points. ---

const LIGHT_APPROACH_RANGE_RATIO = 0.15;
const LIGHT_BLINK_ZONE_WIDTH_RATIO = 0.04;

/** Feeds `frames` frames at a fixed rpm and returns the distinct light-bar
 * colors seen (each bar is expected to be uniform - one color repeated). */
function sampleBlinkColors(
  processor: TelemetryProcessor,
  gear: number,
  ratio: number,
  carOrdinal: number,
  rpm: number,
  frames: number,
): Set<string> {
  const seen = new Set<string>();
  for (let i = 0; i < frames; i++) {
    const r = feedFrame(processor, gear, ratio, carOrdinal, rpm, 0.5);
    const bar = r.efficiency?.lights ?? [];
    assert.ok(
      bar.every((c) => c === bar[0]),
      `expected a uniform bar in the blink zone, got ${bar.join("")}`,
    );
    seen.add(bar[0]);
  }
  return seen;
}

test("shift light bar: default off, then fills green->yellow while approaching the shift point", () => {
  const processor = createTestProcessor();
  const carOrdinal = 8001;

  let baseline;
  for (let i = 0; i < 5; i++) {
    baseline = feedFrame(processor, 5, 30, carOrdinal, 4000 + i * 50, 1);
  }
  const finalShiftRPM = baseline!.efficiency?.finalShiftRPM ?? 0;
  assert.ok(finalShiftRPM > 0, "expected a bootstrapped finalShiftRPM");

  const optimalStart = finalShiftRPM * 0.98;
  const approachStart =
    optimalStart - DOWNSHIFT_MAX_RPM * LIGHT_APPROACH_RANGE_RATIO;

  const off = feedFrame(
    processor,
    5,
    30,
    carOrdinal,
    approachStart - 200,
    0.5,
  );
  assert.deepEqual(
    off.efficiency?.lights,
    new Array(10).fill("⚫"),
    "below the approach range, the bar should be fully off",
  );

  // Exactly halfway through the approach zone: 5 of 10 positions lit, all green.
  const halfway = feedFrame(
    processor,
    5,
    30,
    carOrdinal,
    approachStart + 0.5 * (optimalStart - approachStart),
    0.5,
  );
  assert.deepEqual(
    halfway.efficiency?.lights,
    ["🟢", "🟢", "🟢", "🟢", "🟢", "⚫", "⚫", "⚫", "⚫", "⚫"],
    "halfway through the approach zone, exactly 5 green positions should be lit",
  );

  // 80% through: 8 of 10 lit - positions 1-5 green, 6-8 yellow (yellow starts
  // at position 6, per the requested adjustment).
  const almostThere = feedFrame(
    processor,
    5,
    30,
    carOrdinal,
    approachStart + 0.8 * (optimalStart - approachStart),
    0.5,
  );
  assert.deepEqual(
    almostThere.efficiency?.lights,
    ["🟢", "🟢", "🟢", "🟢", "🟢", "🟡", "🟡", "🟡", "⚫", "⚫"],
    "at 80% approach progress, positions 6-8 should be yellow, not green",
  );
  assert.equal(
    almostThere.efficiency?.recommendations?.upshiftRecommended,
    false,
    "still approaching - upshift should not be recommended yet",
  );
});

test("shift light bar: blinks orange exactly at the upshift trigger point, blinks red past the zone", () => {
  const processor = createTestProcessor();
  const carOrdinal = 8002;

  let baseline;
  for (let i = 0; i < 5; i++) {
    baseline = feedFrame(processor, 5, 30, carOrdinal, 4000 + i * 50, 1);
  }
  const finalShiftRPM = baseline!.efficiency?.finalShiftRPM ?? 0;
  // +5rpm margin above the exact 0.98x boundary: the rpm value round-trips
  // through a 32-bit float in the UDP packet, so testing the exact boundary
  // is flaky - a small margin keeps this unambiguously past the threshold.
  const optimalStart = finalShiftRPM * 0.98 + 5;
  const optimalEnd =
    optimalStart + DOWNSHIFT_MAX_RPM * LIGHT_BLINK_ZONE_WIDTH_RATIO;

  const atTrigger = feedFrame(processor, 5, 30, carOrdinal, optimalStart, 0.5);
  assert.equal(
    atTrigger.efficiency?.recommendations?.upshiftRecommended,
    true,
    "expected this rpm (just above the 0.98x trigger) to already recommend upshift",
  );

  const orangeColors = sampleBlinkColors(processor, 5, 30, carOrdinal, optimalStart, 13);
  assert.deepEqual(
    orangeColors,
    new Set(["🟠", "⚫"]),
    "in the optimal window, the bar should blink between orange and off",
  );

  const redColors = sampleBlinkColors(processor, 5, 30, carOrdinal, optimalEnd + 200, 13);
  assert.deepEqual(
    redColors,
    new Set(["🔴", "⚫"]),
    "past the optimal window, the bar should blink between red and off",
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
          observedRpmLow: 6800,
          observedRpmHigh: 7500,
          wotSampleCount: 32,
          totalSampleCount: 80,
        },
      },
      powerCurve: { powerByRpmBucket: { 5000: 250.4 }, sampleCount: 12 },
      shiftHistory: { 1: [{ rpm: 7000, score: 120.5, timestamp: 1700000000000 }] },
    };

    store.save(profile);
    const loaded = store.load(profile.meta);

    assert.deepEqual(loaded, {
      ...profile,
      gearRatios: { 1: { ratioMedian: 58.234, sampleCount: 30 } }, // rounded to 3 decimals on save
    });
    // A different build (different numCylinders) of the same ordinal should
    // NOT match this saved profile - that's the whole point of the composite key.
    assert.equal(
      store.load({ ...profile.meta, numCylinders: 8 }),
      null,
      "a different build of the same car.ordinal must not match a saved profile for another build",
    );
    assert.equal(store.load({ ...profile.meta, carOrdinal: 999 }), null);

    // The whole point of CSV: every file should be a plain, spreadsheet-openable table.
    const carsCsv = fs.readFileSync(path.join(tmpDir, "cars.csv"), "utf-8");
    assert.match(carsCsv, /^build_key,car_ordinal,car_class,performance_index/);
    assert.match(carsCsv, /^123:6:8000:1,123,5,700/m);

    const powerCurveCsv = fs.readFileSync(
      path.join(tmpDir, "power_curve.csv"),
      "utf-8",
    );
    assert.match(
      powerCurveCsv,
      /^build_key,car_ordinal,car_class,rpm_bucket,power_kw/,
    );
    assert.match(powerCurveCsv, /^123:6:8000:1,123,5,5000,250\.4/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
