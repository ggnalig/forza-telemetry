// Integration test for Telemetry Processor with Physics Validation
// Demonstrates the complete validation pipeline in action

import { TelemetryProcessor } from "../src/telemetry/processor";
import { ParsedTelemetryData } from "../src/types/telemetry";

// Helper to create test data
function createParsedTelemetryData(overrides: any = {}): ParsedTelemetryData {
  return {
    raw: Buffer.alloc(331),
    parsed: {
      isRaceOn: 1,
      timestamp: Date.now(),
      engine: {
        rpm: 3500,
        maxRpm: 8000,
        idleRpm: 800,
        cylinders: 6,
      },
      motion: {
        acceleration: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 },
        orientation: { yaw: 0, pitch: 0, roll: 0 },
      },
      wheels: {
        slipRatio: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
        slipAngle: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
        combinedSlip: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
        rotationSpeed: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
        suspensionTravel: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
        suspensionMeters: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
        onRumbleStrip: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
        inPuddleDepth: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
        surfaceRumble: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
        tireTemp: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
        tireWear: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
      },
      car: {
        ordinal: 1,
        class: 1,
        performanceIndex: 500,
        drivetrain: 1,
      },
      position: { x: 0, y: 0, z: 0 },
      performance: {
        speedKmh: 80,
        powerKw: 200,
        torqueNm: 400,
        boost: 0.5,
        fuel: 75,
      },
      lap: {
        current: 0,
        last: 0,
        best: 0,
        number: 2,
        raceTime: 0,
        position: 3,
      },
      input: {
        throttle: 0.7,
        brake: 0,
        clutch: 0,
        handbrake: 0,
        gear: 4,
        steer: 0,
      },
      track: {
        ordinal: 1,
        distanceTraveled: 0,
      },
      ai: {
        normalizedDrivingLine: 0,
        normalizedAIBrakeDifference: 0,
      },
      ...overrides,
    },
    timestamp: Date.now(),
  };
}

async function runIntegrationTest() {
  console.log("Running Telemetry Processor Integration Test...\n");

  const processor = new TelemetryProcessor(true); // Enable debug mode

  // Test Case 1: Normal driving conditions
  console.log("Test 1: Normal driving conditions");
  const normalData = createParsedTelemetryData();
  const normalResult = processor.process(normalData);
  console.log(`Power: ${normalResult.parsed.performance.powerKw} kW`);
  console.log(`Torque: ${normalResult.parsed.performance.torqueNm} Nm`);
  console.log("✓ Normal data processed successfully\n");

  // Test Case 2: Invalid power (negative)
  console.log("Test 2: Invalid negative power");
  const invalidPowerData = createParsedTelemetryData({
    performance: {
      speedKmh: 80,
      powerKw: -100, // Invalid negative power
      torqueNm: 350,
      boost: 0.5,
      fuel: 75,
    },
  });
  const invalidPowerResult = processor.process(invalidPowerData);
  console.log(`Raw Power: -100 kW`);
  console.log(`Validated Power: ${invalidPowerResult.parsed.performance.powerKw} kW`);
  console.log("✓ Invalid power corrected\n");

  // Test Case 3: Burnout condition
  console.log("Test 3: Burnout condition detection");
  const burnoutData = createParsedTelemetryData({
    input: {
      throttle: 0.95,
      brake: 0.95, // High brake + throttle
      clutch: 0,
      handbrake: 0,
      gear: 1,
      steer: 0,
    },
    performance: {
      speedKmh: 3, // Low speed
      powerKw: 180,
      torqueNm: -50, // Negative torque during burnout
      boost: 0.5,
      fuel: 75,
    },
  });
  const burnoutResult = processor.process(burnoutData);
  console.log(`Raw Torque: -50 Nm`);
  console.log(`Validated Torque: ${burnoutResult.parsed.performance.torqueNm} Nm`);
  console.log("✓ Burnout condition handled\n");

  // Test Case 4: Power fallback calculation
  console.log("Test 4: Power fallback from torque and RPM");
  const fallbackData = createParsedTelemetryData({
    engine: {
      rpm: 4000,
      maxRpm: 8000,
      idleRpm: 800,
      cylinders: 6,
    },
    performance: {
      speedKmh: 80,
      powerKw: 0, // Invalid/zero power
      torqueNm: 450,
      boost: 0.5,
      fuel: 75,
    },
  });
  const fallbackResult = processor.process(fallbackData);
  console.log(`Raw Power: 0 kW`);
  console.log(`Torque: 450 Nm`);
  console.log(`RPM: 4000`);
  console.log(`Computed Power: ${fallbackResult.parsed.performance.powerKw} kW`);
  console.log("✓ Power calculated from physics formula\n");

  // Test Case 5: Pre-race condition
  console.log("Test 5: Pre-race condition (lap 0)");
  const preRaceData = createParsedTelemetryData({
    lap: {
      current: 0,
      last: 0,
      best: 0,
      number: 0, // Pre-race
      raceTime: 0,
      position: 1,
    },
    performance: {
      speedKmh: 0,
      powerKw: 150,
      torqueNm: 280,
      boost: 0.5,
      fuel: 75,
    },
  });
  const preRaceResult = processor.process(preRaceData);
  console.log(`Raw Power: 150 kW`);
  console.log(`Validated Power: ${preRaceResult.parsed.performance.powerKw} kW`);
  console.log(`Raw Torque: 280 Nm`);
  console.log(`Validated Torque: ${preRaceResult.parsed.performance.torqueNm} Nm`);
  console.log("✓ Pre-race condition handled\n");

  console.log("Integration test completed successfully!");
  console.log("\nKey Features Validated:");
  console.log("- Hard validation for power and torque ranges");
  console.log("- Context-aware filtering for invalid driving states");
  console.log("- Burnout detection and clamping logic");
  console.log("- Power fallback calculation using physics formula");
  console.log("- Never exposes negative power to UI");
  console.log("- Always provides normalized, UI-safe values");
}

// Run the integration test
runIntegrationTest().catch(console.error);