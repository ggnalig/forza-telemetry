// Final demonstration: Shift recommendations based on efficiency map
const { TelemetryProcessor } = require('./dist/telemetry/processor.js');

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
        cylinders: 6
      },
      motion: {
        acceleration: { x: 0, y: 0, z: 0 },
        velocity: { x: speed/3.6, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 },
        orientation: { yaw: 0, pitch: 0, roll: 0 }
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
        tireTemp: { frontLeft: 85, frontRight: 87, rearLeft: 90, rearRight: 92 },
        tireWear: { frontLeft: 0.1, frontRight: 0.1, rearLeft: 0.1, rearRight: 0.1 }
      },
      car: {
        ordinal: 1,
        class: 1,
        performanceIndex: 1,
        drivetrain: 1
      },
      position: {
        x: 0,
        y: 0,
        z: 0
      },
      performance: {
        speedKmh: speed,
        powerKw: 285.4,
        torqueNm: 380,
        boost: 1.0,
        fuel: 0.8
      },
      lap: {
        current: 0,
        last: 0,
        best: 0,
        number: 1,
        raceTime: 0,
        position: 1
      },
      input: {
        throttle: throttle,
        brake: 0,
        clutch: 0,
        handbrake: 0,
        gear: gear,
        steer: 0
      },
      track: {
        ordinal: 1,
        distanceTraveled: 0
      },
      ai: {
        normalizedDrivingLine: 0,
        normalizedAIBrakeDifference: 0
      }
    }
  };
}

function demonstrateShiftRecommendations() {
  console.log('🚗 Gear Efficiency Map - Shift Recommendation Demo\n');
  
  const processor = new TelemetryProcessor(false);
  
  // First, build up some efficiency data
  console.log('📊 Building efficiency map...\n');
  
  const learningSequence = [
    { rpm: 2000, gear: 3, speed: 80, desc: 'Low RPM' },
    { rpm: 3500, gear: 3, speed: 110, desc: 'Mid RPM' },
    { rpm: 5000, gear: 3, speed: 140, desc: 'Optimal range' },
    { rpm: 6000, gear: 3, speed: 170, desc: 'High RPM' },
    { rpm: 6500, gear: 3, speed: 190, desc: 'Very high RPM' },
  ];
  
  learningSequence.forEach((frame, index) => {
    const telemetryData = createTestTelemetryData(frame.rpm, frame.gear, frame.speed);
    const processedData = processor.process(telemetryData);
    
    if (processedData.efficiency && processedData.efficiency.map[3]) {
      const efficiency = processedData.efficiency.map[3];
      console.log(`Frame ${index + 1}: ${frame.desc} - ${frame.rpm} RPM`);
      console.log(`  Optimal: ${efficiency.rpmOptimal} RPM, Range: [${efficiency.rpmMin}-${efficiency.rpmMax}]`);
    }
  });
  
  console.log('\n🎯 Now testing shift recommendations:\n');
  
  // Test various RPM scenarios
  const testScenarios = [
    { rpm: 2800, gear: 3, speed: 85, desc: 'Below optimal range' },
    { rpm: 4500, gear: 3, speed: 125, desc: 'In optimal range' },
    { rpm: 6200, gear: 3, speed: 180, desc: 'Above optimal range' },
    { rpm: 3200, gear: 3, speed: 95, desc: 'Low but approaching' },
    { rpm: 5800, gear: 3, speed: 165, desc: 'High but manageable' },
  ];
  
  testScenarios.forEach((scenario, index) => {
    const telemetryData = createTestTelemetryData(scenario.rpm, scenario.gear, scenario.speed);
    const processedData = processor.process(telemetryData);
    
    if (processedData.efficiency && processedData.efficiency.recommendations) {
      const recommendations = processedData.efficiency.recommendations;
      const efficiency = processedData.efficiency.map[3];
      
      console.log(`\nScenario ${index + 1}: ${scenario.desc}`);
      console.log(`  RPM: ${scenario.rpm} | Speed: ${scenario.speed} km/h`);
      console.log(`  Optimal Range: [${efficiency.shiftWindow[0]}-${efficiency.shiftWindow[1]}] RPM`);
      
      if (recommendations.downshiftRecommended) {
        console.log(`  ⚠️  RECOMMENDATION: SHIFT DOWN!`);
        console.log(`     RPM ${scenario.rpm} is below optimal range`);
      } else if (recommendations.upshiftRecommended) {
        console.log(`  ⚠️  RECOMMENDATION: SHIFT UP!`);
        console.log(`     RPM ${scenario.rpm} is above optimal range`);
      } else {
        console.log(`  ✅ OPTIMAL: Stay in current gear`);
        console.log(`     RPM ${scenario.rpm} is in efficiency window`);
      }
    }
  });
  
  console.log('\n🏁 Summary:');
  console.log('The Gear Efficiency Map successfully learns optimal RPM ranges');
  console.log('and provides real-time shift recommendations based on efficiency data.');
  console.log('This enables drivers to maintain peak performance and fuel efficiency.');
}

// Run the demonstration
demonstrateShiftRecommendations();

console.log('\n💡 Key Benefits:');
console.log('✅ Adaptive learning - improves with more data');
console.log('✅ Real-time recommendations - instant feedback');
console.log('✅ Per-gear optimization - tailored to each gear');
console.log('✅ Memory efficient - O(1) per gear');
console.log('✅ 60Hz capable - suitable for racing telemetry');