const {
  GearEfficiencyMapGenerator,
} = require("./dist/services/gear-efficiency-map-generator.js");

const generator = new GearEfficiencyMapGenerator();

const testFrames = [
  { gear: 1, rpm: 2000, speed: 30, torque: 200 },
  { gear: 1, rpm: 3000, speed: 45, torque: 250 },
  { gear: 1, rpm: 4000, speed: 60, torque: 280 },
  { gear: 1, rpm: 5000, speed: 75, torque: 300 },
  { gear: 2, rpm: 2500, speed: 50, torque: 220 },
  { gear: 2, rpm: 3500, speed: 70, torque: 260 },
  { gear: 2, rpm: 4500, speed: 90, torque: 290 },
  { gear: 2, rpm: 5500, speed: 110, torque: 310 },
  { gear: 3, rpm: 3000, speed: 80, torque: 240 },
  { gear: 3, rpm: 4000, speed: 105, torque: 270 },
  { gear: 3, rpm: 5000, speed: 130, torque: 295 },
  { gear: 3, rpm: 6000, speed: 155, torque: 320 },
  { gear: 4, rpm: 3500, speed: 120, torque: 250 },
  { gear: 4, rpm: 4500, speed: 150, torque: 275 },
  { gear: 4, rpm: 5500, speed: 180, torque: 300 },
  { gear: 5, rpm: 4000, speed: 160, torque: 260 },
  { gear: 5, rpm: 5000, speed: 200, torque: 285 },
  { gear: 5, rpm: 6000, speed: 240, torque: 310 },
  { gear: 6, rpm: 3500, speed: 180, torque: 240 },
  { gear: 6, rpm: 4500, speed: 230, torque: 265 },
  { gear: 6, rpm: 5500, speed: 280, torque: 290 },
];

console.log("🚗 Testing Gear Efficiency Map Generator\n");

testFrames.forEach((frame, index) => {
  const result = generator.update(frame);
  const efficiency = result.efficiencyMap[frame.gear];
  const recommendations = result.shiftRecommendations;

  console.log(
    `Frame ${index + 1}: Gear ${frame.gear}, RPM ${frame.rpm}, Speed ${frame.speed}`,
  );
  console.log(
    `  Efficiency: min=${efficiency?.rpmMin}, max=${efficiency?.rpmMax}, avg=${Math.round(efficiency?.rpmAvg || 0)}, optimal=${efficiency?.rpmOptimal}`,
  );
  console.log(
    `  Shift Window: [${efficiency?.shiftWindow[0]}, ${efficiency?.shiftWindow[1]}]`,
  );
  console.log(
    `  Recommendations: up=${recommendations.upshiftRecommended}, down=${recommendations.downshiftRecommended}`,
  );
  console.log("");
});

console.log("📊 Final Efficiency Map:");
const finalMap = generator.getEfficiencyMap();
Object.entries(finalMap).forEach(([gear, stats]) => {
  console.log(
    `Gear ${gear}: optimal=${stats.rpmOptimal} RPM, window=[${stats.shiftWindow[0]}, ${stats.shiftWindow[1]}]`,
  );
});
