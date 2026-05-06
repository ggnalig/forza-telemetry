const { GearEfficiencyMapGenerator } = require('./dist/services/gear-efficiency-map-generator.js');

const generator = new GearEfficiencyMapGenerator();

console.log('🚗 Testing Gear Efficiency Map Generator - Realistic Driving Scenario\n');

const realisticFrames = [
  { gear: 1, rpm: 1500, speed: 20, torque: 180 },
  { gear: 1, rpm: 2500, speed: 35, torque: 220 },
  { gear: 1, rpm: 3500, speed: 50, torque: 260 },
  { gear: 1, rpm: 4500, speed: 65, torque: 290 },
  { gear: 1, rpm: 5500, speed: 80, torque: 310 },
  { gear: 2, rpm: 3000, speed: 70, torque: 240 },
  { gear: 2, rpm: 4000, speed: 95, torque: 270 },
  { gear: 2, rpm: 5000, speed: 120, torque: 295 },
  { gear: 2, rpm: 6000, speed: 145, torque: 320 },
  { gear: 3, rpm: 3500, speed: 110, torque: 250 },
  { gear: 3, rpm: 4500, speed: 140, torque: 275 },
  { gear: 3, rpm: 5500, speed: 170, torque: 300 },
  { gear: 4, rpm: 4000, speed: 160, torque: 260 },
  { gear: 4, rpm: 5000, speed: 200, torque: 285 },
  { gear: 4, rpm: 6000, speed: 240, torque: 310 },
  { gear: 5, rpm: 4500, speed: 210, torque: 270 },
  { gear: 5, rpm: 5500, speed: 260, torque: 295 },
  { gear: 6, rpm: 4000, speed: 230, torque: 250 },
  { gear: 6, rpm: 5000, speed: 290, torque: 275 },
];

realisticFrames.forEach((frame, index) => {
  const result = generator.update(frame);
  const efficiency = result.efficiencyMap[frame.gear];
  const recommendations = result.shiftRecommendations;
  
  console.log(`Frame ${index + 1}: Gear ${frame.gear}, RPM ${frame.rpm}, Speed ${frame.speed}`);
  console.log(`  Efficiency: min=${efficiency?.rpmMin}, max=${efficiency?.rpmMax}, avg=${Math.round(efficiency?.rpmAvg || 0)}, optimal=${efficiency?.rpmOptimal}`);
  console.log(`  Shift Window: [${efficiency?.shiftWindow[0]}, ${efficiency?.shiftWindow[1]}]`);
  console.log(`  Recommendations: up=${recommendations.upshiftRecommended}, down=${recommendations.downshiftRecommended}`);
  console.log('');
});

console.log('📊 Final Efficiency Map Summary:');
const finalMap = generator.getEfficiencyMap();
Object.entries(finalMap).forEach(([gear, stats]) => {
  console.log(`Gear ${gear}:`);
  console.log(`  Optimal RPM: ${stats.rpmOptimal}`);
  console.log(`  RPM Range: ${stats.rpmMin} - ${stats.rpmMax}`);
  console.log(`  Average RPM: ${Math.round(stats.rpmAvg)}`);
  console.log(`  Shift Window: [${stats.shiftWindow[0]}, ${stats.shiftWindow[1]}]`);
  console.log('');
});