// Debug the actual function calls
const { GearAwareShiftService } = require('./dist/services/gear-aware-shift-service-rpm-peak');

const service = new GearAwareShiftService();

// Override the function to add logging
const originalCalculateShift = service.calculateShift;
service.calculateShift = function(telemetry) {
  console.log('🔄 calculateShift called with:', {
    rpm: telemetry.engine.rpm,
    gear: telemetry.input.gear,
    maxRpm: telemetry.engine.maxRpm
  });
  
  const result = originalCalculateShift.call(this, telemetry);
  
  console.log('📊 Result:', {
    state: result.state,
    rpmProgressInGear: result.debug?.rpmProgressInGear,
    currentRatio: result.debug?.currentRatio,
    nextRatio: result.debug?.nextRatio
  });
  
  return result;
};

// Test
const telemetry = {
  timestamp: Date.now(),
  engine: { rpm: 6000, maxRpm: 8000, power: 450, torque: 380 },
  input: { gear: 3, throttle: 1.0, brake: 0, clutch: 0 }
};

console.log('Testing with telemetry:', telemetry);
const result = service.calculateShift(telemetry);
console.log('Final result progressive:', result.progressive.join(''));