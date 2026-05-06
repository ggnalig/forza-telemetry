// Quick debug test for RPM progress calculation
const { GearAwareShiftService } = require('./dist/services/gear-aware-shift-service-rpm-peak');

const service = new GearAwareShiftService();

// Test manual calculation
function testManualCalculation() {
  console.log('🔍 Testing Manual RPM Progress Calculation\n');
  
  const testCases = [
    { rpm: 4000, maxRpm: 8000, gear: 3, currentRatio: 1.49 },
    { rpm: 6000, maxRpm: 8000, gear: 3, currentRatio: 1.49 },
    { rpm: 7800, maxRpm: 8000, gear: 3, currentRatio: 1.49 },
  ];
  
  testCases.forEach(({ rpm, maxRpm, gear, currentRatio }) => {
    console.log(`--- RPM: ${rpm}, Gear: ${gear}, Max RPM: ${maxRpm}, Ratio: ${currentRatio} ---`);
    
    // Manual calculation step by step
    const gearFactor = Math.max(0.5, 1 - (gear - 1) * 0.08);
    console.log(`gearFactor: ${gearFactor}`);
    
    const practicalMaxRpm = maxRpm * gearFactor;
    console.log(`practicalMaxRpm: ${practicalMaxRpm}`);
    
    const safeRatio = Math.max(0.1, currentRatio || 1.0);
    console.log(`safeRatio: ${safeRatio}`);
    
    const ratioFactor = Math.min(1.0, safeRatio / 2.0);
    console.log(`ratioFactor: ${ratioFactor}`);
    
    const adjustedMaxRpm = practicalMaxRpm * (0.8 + ratioFactor * 0.2);
    console.log(`adjustedMaxRpm: ${adjustedMaxRpm}`);
    
    const safeAdjustedMaxRpm = Math.max(1000, adjustedMaxRpm);
    console.log(`safeAdjustedMaxRpm: ${safeAdjustedMaxRpm}`);
    
    const progress = Math.min(1, rpm / safeAdjustedMaxRpm);
    console.log(`progress: ${progress} (${(progress * 100).toFixed(1)}%)`);
    
    console.log('');
  });
}

// Test actual service
function testService() {
  console.log('🚗 Testing Actual Service\n');
  
  const testCases = [
    { rpm: 4000, gear: 3 },
    { rpm: 6000, gear: 3 },
    { rpm: 7800, gear: 3 },
  ];
  
  testCases.forEach(({ rpm, gear }) => {
    const telemetry = {
      timestamp: Date.now(),
      engine: { rpm, maxRpm: 8000, power: 450, torque: 380 },
      input: { gear, throttle: 1.0, brake: 0, clutch: 0 }
    };
    
    const result = service.calculateShift(telemetry);
    console.log(`RPM: ${rpm}, Gear: ${gear}`);
    console.log(`Progress: ${(result.debug.rpmProgressInGear * 100).toFixed(1)}%`);
    console.log(`LEDs: ${result.progressive.join('')}`);
    console.log('');
  });
}

testManualCalculation();
testService();