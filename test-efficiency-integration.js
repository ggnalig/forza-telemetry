// Integration example: Gear Efficiency Map Generator with Telemetry Processor
const { GearEfficiencyMapGenerator } = require('./dist/services/gear-efficiency-map-generator.js');

const generator = new GearEfficiencyMapGenerator();

function simulateTelemetryProcessing() {
  console.log('🔄 Simulating Real-Time Telemetry Processing with Efficiency Map\n');
  
  // Simulate typical racing telemetry stream
  const telemetryStream = [
    { gear: 1, rpm: 2000, speed: 25, torque: 190 },
    { gear: 1, rpm: 3500, speed: 45, torque: 250 },
    { gear: 1, rpm: 5000, speed: 70, torque: 300 },
    { gear: 2, rpm: 3000, speed: 65, torque: 230 },
    { gear: 2, rpm: 4500, speed: 95, torque: 280 },
    { gear: 2, rpm: 5800, speed: 125, torque: 320 },
    { gear: 3, rpm: 3500, speed: 110, torque: 250 },
    { gear: 3, rpm: 4800, speed: 150, torque: 290 },
    { gear: 3, rpm: 6200, speed: 195, torque: 340 },
    { gear: 4, rpm: 4000, speed: 170, torque: 260 },
    { gear: 4, rpm: 5200, speed: 220, torque: 300 },
    { gear: 4, rpm: 6500, speed: 275, torque: 350 },
    { gear: 5, rpm: 4500, speed: 240, torque: 270 },
    { gear: 5, rpm: 5500, speed: 295, torque: 310 },
    { gear: 6, rpm: 4200, speed: 280, torque: 250 },
    { gear: 6, rpm: 5000, speed: 335, torque: 285 },
  ];
  
  let frameCount = 0;
  
  telemetryStream.forEach(frame => {
    frameCount++;
    const result = generator.update(frame);
    const efficiency = result.efficiencyMap[frame.gear];
    const recommendations = result.shiftRecommendations;
    
    console.log(`Frame ${frameCount}: Gear ${frame.gear}, ${frame.rpm} RPM, ${frame.speed} km/h`);
    
    if (efficiency && efficiency.rpmOptimal > 0) {
      console.log(`  🎯 Optimal: ${efficiency.rpmOptimal} RPM (Window: [${efficiency.shiftWindow[0]}-${efficiency.shiftWindow[1]}])`);
      
      if (recommendations.upshiftRecommended) {
        console.log(`  ⚡ SHIFT UP! RPM too high for optimal efficiency`);
      } else if (recommendations.downshiftRecommended) {
        console.log(`  🔽 SHIFT DOWN! RPM too low for optimal efficiency`);
      } else {
        console.log(`  ✅ In optimal efficiency range`);
      }
    } else {
      console.log(`  📊 Learning efficiency pattern...`);
    }
    
    console.log('');
  });
  
  console.log('🏁 Final Gear Efficiency Analysis:');
  const finalMap = generator.getEfficiencyMap();
  
  Object.entries(finalMap).forEach(([gear, stats]) => {
    console.log(`\nGear ${gear}:`);
    console.log(`  Optimal RPM: ${stats.rpmOptimal}`);
    console.log(`  Operating Range: ${stats.rpmMin} - ${stats.rpmMax} RPM`);
    console.log(`  Average RPM: ${Math.round(stats.rpmAvg)}`);
    console.log(`  Efficiency Window: [${stats.shiftWindow[0]}, ${stats.shiftWindow[1]}] RPM`);
    
    if (stats.rpmOptimal > 0) {
      const efficiencyRange = stats.shiftWindow[1] - stats.shiftWindow[0];
      console.log(`  Efficiency Bandwidth: ${efficiencyRange} RPM`);
    }
  });
}

// Run the simulation
simulateTelemetryProcessing();

console.log('\n💡 Key Features Demonstrated:');
console.log('✅ Real-time efficiency learning (no ML, no history buffers)');
console.log('✅ Per-gear optimal RPM detection based on speed gain');
console.log('✅ Dynamic shift window calculation');
console.log('✅ Lightweight memory usage (O(1) per gear)');
console.log('✅ 60Hz real-time capable processing');
console.log('✅ Deterministic and simple logic');