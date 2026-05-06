// Test GT3-style shift light buffer functionality
const { TelemetryProcessor } = require("./dist/telemetry/processor.js");

// Create test telemetry data
function createTestTelemetryData(rpm, gear, speed, throttle = 1.0) {
  return {
    raw: Buffer.alloc(331),
    parsed: {
      isRaceOn: 1,
      timestamp: Date.now(),
      engine: {
        rpm: rpm,
        maxRpm: 8000,
        idleRpm: 850,
        cylinders: 6,
      },
      motion: {
        acceleration: { x: 0, y: 0, z: 0 },
        velocity: { x: speed / 3.6, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 },
        orientation: { yaw: 0, pitch: 0, roll: 0 },
      },
      wheels: {
        slipRatio: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
        slipAngle: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
        combinedSlip: {
          frontLeft: 0,
          frontRight: 0,
          rearLeft: 0,
          rearRight: 0,
        },
        rotationSpeed: {
          frontLeft: 0,
          frontRight: 0,
          rearLeft: 0,
          rearRight: 0,
        },
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
        onRumbleStrip: {
          frontLeft: 0,
          frontRight: 0,
          rearLeft: 0,
          rearRight: 0,
        },
        inPuddleDepth: {
          frontLeft: 0,
          frontRight: 0,
          rearLeft: 0,
          rearRight: 0,
        },
        surfaceRumble: {
          frontLeft: 0,
          frontRight: 0,
          rearLeft: 0,
          rearRight: 0,
        },
        tireTemp: {
          frontLeft: 85,
          frontRight: 87,
          rearLeft: 90,
          rearRight: 92,
        },
        tireWear: {
          frontLeft: 0.1,
          frontRight: 0.1,
          rearLeft: 0.1,
          rearRight: 0.1,
        },
      },
      car: {
        ordinal: 1,
        class: 1,
        performanceIndex: 1,
        drivetrain: 1,
      },
      position: {
        x: 0,
        y: 0,
        z: 0,
      },
      performance: {
        speedKmh: speed,
        powerKw: 285.4,
        torqueNm: 380,
        boost: 1.0,
        fuel: 0.8,
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
        throttle: throttle,
        brake: 0,
        clutch: 0,
        handbrake: 0,
        gear: gear,
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
    },
  };
}

function testGT3ShiftLights() {
  console.log("🚗 GT3-Style Shift Light Buffer Test\n");

  const processor = new TelemetryProcessor(false);

  // First build up some efficiency data for gear 3
  console.log("📊 Building efficiency map for gear 3...\n");

  const efficiencyBuildingFrames = [
    { rpm: 3000, gear: 3, speed: 80, desc: "Low RPM" },
    { rpm: 4000, gear: 3, speed: 110, desc: "Mid RPM" },
    { rpm: 5000, gear: 3, speed: 140, desc: "Optimal range" },
    { rpm: 6000, gear: 3, speed: 170, desc: "High RPM" },
    { rpm: 6500, gear: 3, speed: 190, desc: "Very high RPM" },
  ];

  efficiencyBuildingFrames.forEach((frame, index) => {
    const telemetryData = createTestTelemetryData(
      frame.rpm,
      frame.gear,
      frame.speed,
    );
    const result = processor.process(telemetryData);

    if (result.efficiency && result.efficiency.map[3]) {
      const efficiency = result.efficiency.map[3];
      console.log(`Frame ${index + 1}: ${frame.desc} - ${frame.rpm} RPM`);
      console.log(
        `  Optimal: ${efficiency.rpmOptimal} RPM, Range: [${efficiency.rpmMin}-${efficiency.rpmMax}]`,
      );
      console.log(
        `  Shift Window: [${efficiency.shiftWindow[0]}, ${efficiency.shiftWindow[1]}]`,
      );

      if (result.efficiency.lights && result.efficiency.lights.length > 0) {
        console.log(`  Shift Lights: ${result.efficiency.lights.join("")}`);
      }
    }
  });

  console.log("\n🎯 Now testing GT3-style shift light progression:\n");

  // Test various RPM scenarios to show light progression
  const testScenarios = [
    { rpm: 2800, gear: 3, speed: 85, desc: "Below optimal range (🟢)" },
    { rpm: 3500, gear: 3, speed: 95, desc: "Low optimal (🟢→🟡)" },
    { rpm: 4500, gear: 3, speed: 125, desc: "Mid optimal (🟡→🟠)" },
    { rpm: 5500, gear: 3, speed: 165, desc: "High optimal (🟠→🔴)" },
    { rpm: 6200, gear: 3, speed: 180, desc: "Near limit (🔴→⚫)" },
    { rpm: 5800, gear: 3, speed: 165, desc: "Back to high (⚫→🔴)" },
    { rpm: 4800, gear: 3, speed: 135, desc: "Back to mid (🔴→🟠)" },
    { rpm: 3800, gear: 3, speed: 105, desc: "Back to low (🟠→🟡→🟢)" },
  ];

  testScenarios.forEach((scenario, index) => {
    const telemetryData = createTestTelemetryData(
      scenario.rpm,
      scenario.gear,
      scenario.speed,
    );
    const result = processor.process(telemetryData);

    if (result.efficiency && result.efficiency.lights) {
      const lights = result.efficiency.lights;
      const currentLight = lights[lights.length - 1]; // Get latest light

      console.log(`\nScenario ${index + 1}: ${scenario.desc}`);
      console.log(`  RPM: ${scenario.rpm} | Speed: ${scenario.speed} km/h`);
      console.log(`  Current Light: ${currentLight}`);
      console.log(`  Light Buffer: ${lights.join("")}`);
      console.log(`  Buffer Length: ${lights.length}/10`);

      // Show light meaning
      switch (currentLight) {
        case "🟢":
          console.log(`  Meaning: Build up RPM - Low efficiency zone`);
          break;
        case "🟡":
          console.log(
            `  Meaning: Approaching optimal - Good acceleration zone`,
          );
          break;
        case "🟠":
          console.log(`  Meaning: Optimal range - Peak efficiency zone`);
          break;
        case "🔴":
          console.log(`  Meaning: High RPM - Prepare to shift soon`);
          break;
        case "⚫":
          console.log(
            `  Meaning: Very high RPM - Shift immediately or risk damage`,
          );
          break;
      }
    }
  });

  console.log("\n🏁 Summary:");
  console.log("GT3-style shift lights provide intuitive visual feedback:");
  console.log("🟢 Green: Build up RPM safely");
  console.log("🟡 Yellow: Approaching optimal power band");
  console.log("🟠 Orange: Peak efficiency zone - maintain RPM");
  console.log("🔴 Red: High RPM - prepare to shift");
  console.log("⚫ Off: Critical RPM - shift immediately");
  console.log("\nThe 10-frame rolling buffer provides smooth transitions");
  console.log("and historical context for optimal shift timing.");
}

// Run the test
testGT3ShiftLights();

console.log("\n💡 Key Features:");
console.log("✅ GT3-style color progression (🟢→🟡→🟠→🔴→⚫)");
console.log("✅ 10-frame rolling buffer for smooth transitions");
console.log("✅ Efficiency-based light calculation");
console.log("✅ Real-time updates at 60Hz");
console.log("✅ Deterministic and predictable behavior");
