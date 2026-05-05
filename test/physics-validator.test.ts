// Critical Data Interpretation Rules Tests for Physics Validator
// Tests the updated implementation with W to kW conversion and UI normalization

import { PhysicsValidator } from "../src/telemetry/physics-validator";
import { TelemetryData } from "../src/types/telemetry";

// Test result tracking
interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
  expected?: any;
  actual?: any;
}

class TestRunner {
  private results: TestResult[] = [];

  test(name: string, testFn: () => void) {
    try {
      testFn();
      this.results.push({ name, passed: true });
      console.log(`✓ ${name}`);
    } catch (error: any) {
      this.results.push({
        name,
        passed: false,
        message: error.message,
        expected: error.expected,
        actual: error.actual,
      });
      console.log(`✗ ${name}: ${error.message}`);
    }
  }

  expect(actual: any) {
    return {
      toBe: (expected: any) => {
        if (actual !== expected) {
          const error = new Error(`Expected ${expected}, but got ${actual}`);
          (error as any).expected = expected;
          (error as any).actual = actual;
          throw error;
        }
      },
      toBeGreaterThanOrEqual: (expected: any) => {
        if (actual < expected) {
          const error = new Error(`Expected ${actual} to be >= ${expected}`);
          (error as any).expected = expected;
          (error as any).actual = actual;
          throw error;
        }
      },
      toBeLessThanOrEqual: (expected: any) => {
        if (actual > expected) {
          const error = new Error(`Expected ${actual} to be <= ${expected}`);
          (error as any).expected = expected;
          (error as any).actual = actual;
          throw error;
        }
      },
      toBeCloseTo: (expected: any, precision: number) => {
        const multiplier = Math.pow(10, precision);
        const actualRounded = Math.round(actual * multiplier) / multiplier;
        const expectedRounded = Math.round(expected * multiplier) / multiplier;
        if (actualRounded !== expectedRounded) {
          const error = new Error(
            `Expected ${actual} to be close to ${expected}`,
          );
          (error as any).expected = expected;
          (error as any).actual = actual;
          throw error;
        }
      },
    };
  }

  summary() {
    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;
    const total = this.results.length;

    console.log(`\nTest Summary: ${passed}/${total} passed, ${failed} failed`);

    if (failed > 0) {
      console.log("\nFailed tests:");
      this.results
        .filter((r) => !r.passed)
        .forEach((r) => {
          console.log(`  - ${r.name}: ${r.message}`);
          if (r.expected !== undefined && r.actual !== undefined) {
            console.log(`    Expected: ${r.expected}, Actual: ${r.actual}`);
          }
        });
    }

    return failed === 0;
  }
}

// Helper function to create test telemetry data
function createTestTelemetry(
  overrides: Partial<TelemetryData> = {},
): TelemetryData {
  const defaultTelemetry: TelemetryData = {
    isRaceOn: 1,
    timestamp: Date.now(),
    engine: {
      rpm: 3000,
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
      suspensionTravel: {
        frontLeft: 0,
        frontRight: 0,
        rearLeft: 0,
        rearRight: 0,
      },
      suspensionMeters: {
        frontLeft: 0,
        frontRight: 0,
        rearLeft: 0,
        rearRight: 0,
      },
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
      speedKmh: 50,
      powerKw: 150000, // Raw power in WATTS (150 kW)
      torqueNm: 300,
      boost: 0,
      fuel: 50,
    },
    lap: {
      current: 0,
      last: 0,
      best: 0,
      number: 1,
      raceTime: 0,
      position: 1,
    },
    input: {
      throttle: 0.5,
      brake: 0,
      clutch: 0,
      handbrake: 0,
      gear: 3,
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
  };

  return { ...defaultTelemetry, ...overrides };
}

async function runTests() {
  const runner = new TestRunner();
  const validator = new PhysicsValidator(true); // Enable debug mode

  console.log("Running Critical Data Interpretation Rules Tests...\n");

  // CRITICAL DATA INTERPRETATION RULES Tests
  console.log("1. POWER UNIT CONVERSION (W to kW):");

  runner.test("should convert raw power from W to kW correctly", () => {
    const telemetry = createTestTelemetry({
      performance: {
        speedKmh: 50,
        powerKw: 150000,
        torqueNm: 300,
        boost: 0,
        fuel: 50,
      }, // 150 kW in WATTS
    });
    const result = validator.validatePhysicsData(telemetry);
    runner.expect(result.power).toBeCloseTo(150, 1); // Should be ~150 kW
    runner.expect(result.debugInfo.rawPower).toBe(150000); // Raw in WATTS
  });

  runner.test(
    "should handle negative power in Watts with positive torque using fallback",
    () => {
      const telemetry = createTestTelemetry({
        performance: {
          speedKmh: 50,
          powerKw: -50000,
          torqueNm: 300,
          boost: 0,
          fuel: 50,
        }, // -50 kW in WATTS
      });
      const result = validator.validatePhysicsData(telemetry);
      runner.expect(result.validationReason).toBe("power_fallback");
      runner.expect(result.power).toBeGreaterThanOrEqual(0); // Computed from torque
      runner.expect(result.debugInfo.rawPower).toBe(-50000); // Raw in WATTS
    },
  );

  console.log("\n2. ENGINE OUTPUT NORMALIZATION (torque >= 0 for UI):");

  runner.test("should clamp negative torque to 0 for UI display", () => {
    const telemetry = createTestTelemetry({
      performance: {
        speedKmh: 50,
        powerKw: 150000,
        torqueNm: -50,
        boost: 0,
        fuel: 50,
      },
    });
    const result = validator.validatePhysicsData(telemetry);
    runner.expect(result.torque).toBe(0); // Clamped to 0 for UI
    runner.expect(result.debugInfo.rawTorque).toBe(-50); // Raw can be negative
  });

  runner.test("should preserve positive torque for UI", () => {
    const telemetry = createTestTelemetry({
      performance: {
        speedKmh: 50,
        powerKw: 150000,
        torqueNm: 400,
        boost: 0,
        fuel: 50,
      },
    });
    const result = validator.validatePhysicsData(telemetry);
    runner.expect(result.torque).toBe(400); // Preserved for UI
  });

  console.log("\n3. INVALID STATE HANDLING (RPM <= idle RPM):");

  runner.test("should force zero values when RPM <= idle RPM", () => {
    const telemetry = createTestTelemetry({
      engine: { rpm: 500, maxRpm: 8000, idleRpm: 800, cylinders: 6 },
      performance: {
        speedKmh: 50,
        powerKw: 150000,
        torqueNm: 300,
        boost: 0,
        fuel: 50,
      },
    });
    const result = validator.validatePhysicsData(telemetry);
    runner.expect(result.torque).toBe(0);
    runner.expect(result.power).toBe(0);
    runner.expect(result.validationReason).toBe("invalid_driving_state");
  });

  runner.test("should force zero values when speed < 1", () => {
    const telemetry = createTestTelemetry({
      performance: {
        speedKmh: 0,
        powerKw: 150000,
        torqueNm: 300,
        boost: 0,
        fuel: 50,
      },
    });
    const result = validator.validatePhysicsData(telemetry);
    runner.expect(result.torque).toBe(0);
    runner.expect(result.power).toBe(0);
    runner.expect(result.validationReason).toBe("invalid_driving_state");
  });

  runner.test("should force zero values when lapNumber === 0", () => {
    const telemetry = createTestTelemetry({
      lap: {
        current: 0,
        last: 0,
        best: 0,
        number: 0,
        raceTime: 0,
        position: 1,
      },
      performance: {
        speedKmh: 50,
        powerKw: 150000,
        torqueNm: 300,
        boost: 0,
        fuel: 50,
      },
    });
    const result = validator.validatePhysicsData(telemetry);
    runner.expect(result.torque).toBe(0);
    runner.expect(result.power).toBe(0);
    runner.expect(result.validationReason).toBe("invalid_driving_state");
  });

  console.log("\n4. BURNOUT HANDLING (recompute power with clamped torque):");

  runner.test(
    "should detect burnout and recompute power using clamped torque",
    () => {
      const telemetry = createTestTelemetry({
        input: {
          throttle: 0.95,
          brake: 0.95,
          clutch: 0,
          handbrake: 0,
          gear: 1,
          steer: 0,
        },
        performance: {
          speedKmh: 2,
          powerKw: 150000,
          torqueNm: -50,
          boost: 0,
          fuel: 50,
        }, // Negative torque
      });
      const result = validator.validatePhysicsData(telemetry);
      runner.expect(result.validationReason).toBe("burnout_detected");
      runner.expect(result.torque).toBe(0); // Clamped to 0
      runner.expect(result.power).toBeGreaterThanOrEqual(0); // Recomputed from clamped torque
    },
  );

  console.log("\n5. OUTPUT CONTRACT (0-1500 kW limits):");

  runner.test(
    "should clamp power to realistic engine limits (0-1500 kW)",
    () => {
      const telemetry = createTestTelemetry({
        engine: { rpm: 6000, maxRpm: 8000, idleRpm: 800, cylinders: 6 },
        performance: {
          speedKmh: 50,
          powerKw: 2000000,
          torqueNm: 800,
          boost: 0,
          fuel: 50,
        }, // 2000 kW in WATTS
      });
      const result = validator.validatePhysicsData(telemetry);
      runner.expect(result.power).toBeLessThanOrEqual(1500); // Clamped to max
      runner.expect(result.power).toBeGreaterThanOrEqual(0); // Never negative
    },
  );

  runner.test("should NEVER expose negative power to UI", () => {
    const negativeCases = [-100000, -1000, -500000]; // Negative power in WATTS

    negativeCases.forEach((powerW) => {
      const telemetry = createTestTelemetry({
        performance: {
          speedKmh: 50,
          powerKw: powerW,
          torqueNm: 300,
          boost: 0,
          fuel: 50,
        },
      });
      const result = validator.validatePhysicsData(telemetry);
      runner.expect(result.power).toBeGreaterThanOrEqual(0);
    });
  });

  runner.test("should NEVER expose negative torque to UI", () => {
    const negativeCases = [-50, -100, -200];

    negativeCases.forEach((torque) => {
      const telemetry = createTestTelemetry({
        performance: {
          speedKmh: 50,
          powerKw: 150000,
          torqueNm: torque,
          boost: 0,
          fuel: 50,
        },
      });
      const result = validator.validatePhysicsData(telemetry);
      runner.expect(result.torque).toBeGreaterThanOrEqual(0);
    });
  });

  console.log("\n6. POWER FALLBACK CALCULATION:");

  runner.test("should calculate power from torque and RPM when needed", () => {
    const telemetry = createTestTelemetry({
      engine: { rpm: 3000, maxRpm: 8000, idleRpm: 800, cylinders: 6 },
      performance: {
        speedKmh: 50,
        powerKw: 0,
        torqueNm: 400,
        boost: 0,
        fuel: 50,
      }, // 0 power
    });
    const result = validator.validatePhysicsData(telemetry);
    runner.expect(result.validationReason).toBe("power_fallback");
    runner.expect(result.power).toBeGreaterThanOrEqual(0);
    // Expected: P = 400 Nm × (3000 × 2π / 60) rad/s / 1000 = ~125.66 kW
    runner.expect(result.power).toBeCloseTo(125.66, 1);
  });

  // Final summary
  const success = runner.summary();
  process.exit(success ? 0 : 1);
}

// Run the tests
runTests().catch(console.error);
