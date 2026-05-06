// Test file for RPM Peak Alternative implementation
const { GearAwareShiftService } = require('./dist/services/gear-aware-shift-service-rpm-peak');

// Create test telemetry data
function createTestTelemetry(rpm, gear, throttle = 1.0) {
  return {
    timestamp: Date.now(),
    engine: {
      rpm: rpm,
      maxRpm: 8000,
      power: 450,
      torque: 380
    },
    input: {
      gear: gear,
      throttle: throttle,
      brake: 0,
      clutch: 0
    }
  };
}

// Test the RPM peak alternative
function testRpmPeakAlternative() {
  console.log('🚗 Testing RPM Peak Alternative Implementation\n');
  
  const service = new GearAwareShiftService();
  
  console.log("Testing individual cases first...\n");
  
  // Test individual cases
  const individualCases = [
    { rpm: 4000, gear: 3, desc: "Gear 3 - 4000 RPM (EARLY)" },
    { rpm: 5500, gear: 3, desc: "Gear 3 - 5500 RPM (OPTIMAL)" },
    { rpm: 7850, gear: 3, desc: "Gear 3 - 7850 RPM (LATE)" },
  ];
  
  individualCases.forEach((testCase, index) => {
    console.log(`--- ${testCase.desc} ---`);
    const telemetry = createTestTelemetry(testCase.rpm, testCase.gear);
    const result = service.calculateShift(telemetry);
    
    console.log(`RPM: ${testCase.rpm} | Gear: ${testCase.gear}`);
    if (result.debug) {
      console.log(`Current Ratio: ${result.debug.currentRatio} | Next Ratio: ${result.debug.nextRatio || 'N/A'}`);
      console.log(`RPM Progress in Gear: ${(result.debug.rpmProgressInGear * 100).toFixed(1)}%`);
      if (result.debug.optimalShiftPoint) {
        console.log(`Optimal Shift Point: ${(result.debug.optimalShiftPoint * 100).toFixed(1)}%`);
      }
    }
    console.log(`Progressive LEDs: ${result.progressive.join('')}`);
    console.log(`State: ${result.state} | Light: ${result.light}`);
    console.log('');
  });
  
  console.log("Now testing comprehensive scenarios...\n");
  
  // Test scenarios for different gears and RPM ranges
  const testCases = [
    // Gear 1 - Low RPM
    { rpm: 3000, gear: 1, desc: 'Gear 1 - Low RPM' },
    { rpm: 5000, gear: 1, desc: 'Gear 1 - Mid RPM' },
    { rpm: 7000, gear: 1, desc: 'Gear 1 - High RPM' },
    { rpm: 7800, gear: 1, desc: 'Gear 1 - Near Redline' },
    
    // Gear 2 - Various RPM
    { rpm: 3500, gear: 2, desc: 'Gear 2 - Low RPM' },
    { rpm: 5500, gear: 2, desc: 'Gear 2 - Mid RPM' },
    { rpm: 7200, gear: 2, desc: 'Gear 2 - High RPM' },
    
    // Gear 3 - Optimal shift points
    { rpm: 4000, gear: 3, desc: 'Gear 3 - Low RPM' },
    { rpm: 6000, gear: 3, desc: 'Gear 3 - Mid RPM' },
    { rpm: 6800, gear: 3, desc: 'Gear 3 - High RPM' },
    
    // Gear 4 - Higher speeds
    { rpm: 4500, gear: 4, desc: 'Gear 4 - Low RPM' },
    { rpm: 6200, gear: 4, desc: 'Gear 4 - Mid RPM' },
    { rpm: 7000, gear: 4, desc: 'Gear 4 - High RPM' },
    
    // Gear 5 - Highway speeds
    { rpm: 4000, gear: 5, desc: 'Gear 5 - Cruising' },
    { rpm: 5800, gear: 5, desc: 'Gear 5 - Accelerating' },
    { rpm: 6500, gear: 5, desc: 'Gear 5 - High speed' },
    
    // Gear 6 - Top gear (no next gear available)
    { rpm: 3500, gear: 6, desc: 'Gear 6 - Efficient cruising (no upshift)' },
    { rpm: 5000, gear: 6, desc: 'Gear 6 - Passing (no upshift)' },
    { rpm: 6000, gear: 6, desc: 'Gear 6 - High speed (no upshift)' },
    
    // Edge cases
    { rpm: 2000, gear: 1, throttle: 0.1, desc: 'Low throttle' },
    { rpm: 8000, gear: 3, desc: 'At rev limiter' },
    { rpm: 8200, gear: 2, desc: 'Over rev limit' }
  ];
  
  testCases.forEach((testCase, index) => {
    console.log(`\n--- Test Case ${index + 1}: ${testCase.desc} ---`);
    const telemetry = createTestTelemetry(testCase.rpm, testCase.gear, testCase.throttle || 1.0);
    const result = service.calculateShift(telemetry);
    
    console.log(`RPM: ${testCase.rpm} | Gear: ${testCase.gear} | Throttle: ${testCase.throttle || 1.0}`);
    
    // Add gear ratio debug info
    if (result.debug) {
      console.log(`Current Ratio: ${result.debug.currentRatio} | Next Ratio: ${result.debug.nextRatio || 'N/A'}`);
      console.log(`RPM Progress in Gear: ${(result.debug.rpmProgressInGear * 100).toFixed(1)}%`);
      if (result.debug.optimalShiftPoint) {
        console.log(`Optimal Shift Point: ${(result.debug.optimalShiftPoint * 100).toFixed(1)}%`);
      }
    }
    
    console.log(`Progressive LEDs: ${result.progressive.join('')}`);
    console.log(`State: ${result.state} | Light: ${result.light}`);
    
    if (result.rpmAfterShift !== null) {
      console.log(`RPM After Shift: ${Math.round(result.rpmAfterShift)}`);
    }
    if (result.rpmDrop !== null) {
      console.log(`RPM Drop: ${Math.round(result.rpmDrop)}`);
    }
    
    console.log(`Reason: ${result.reason}`);
    if (result.blink) {
      console.log('⚠️  BLINKING - Approaching rev limiter!');
    }
  });
  
  // Summary analysis
  console.log('\n📊 SUMMARY ANALYSIS:');
  console.log('This RPM Peak Alternative approach provides:');
  console.log('✅ Intuitive LED progression based on RPM within each gear');
  console.log('✅ Gear-aware optimal shift points (close vs wide ratio)');
  console.log('✅ Practical max RPM that varies by gear (lower gears can rev higher)');
  console.log('✅ Clear visual feedback that matches driver intuition');
  console.log('✅ Proper handling of gear characteristics and spread');
}

// Run the test
testRpmPeakAlternative();