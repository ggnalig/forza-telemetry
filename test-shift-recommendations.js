const {
  GearEfficiencyMapGenerator,
} = require("./dist/services/gear-efficiency-map-generator.js");

const generator = new GearEfficiencyMapGenerator();

console.log("🚗 Testing Shift Recommendations with Varying RPM\n");

const testScenario = [
  { gear: 3, rpm: 2500, speed: 60, torque: 200 },
  { gear: 3, rpm: 3000, speed: 80, torque: 240 },
  { gear: 3, rpm: 3500, speed: 100, torque: 270 },
  { gear: 3, rpm: 4000, speed: 125, torque: 295 },
  { gear: 3, rpm: 4500, speed: 150, torque: 320 },
  { gear: 3, rpm: 5000, speed: 175, torque: 340 },
  { gear: 3, rpm: 5500, speed: 200, torque: 360 },
  { gear: 3, rpm: 6000, speed: 225, torque: 380 },
  { gear: 3, rpm: 6500, speed: 250, torque: 400 },
];

testScenario.forEach((frame, index) => {
  const result = generator.update(frame);
  const efficiency = result.efficiencyMap[frame.gear];
  const recommendations = result.shiftRecommendations;

  console.log(
    `Frame ${index + 1}: Gear ${frame.gear}, RPM ${frame.rpm}, Speed ${frame.speed}`,
  );
  console.log(
    `  Optimal RPM: ${efficiency?.rpmOptimal}, Window: [${efficiency?.shiftWindow[0]}, ${efficiency?.shiftWindow[1]}]`,
  );
  console.log(
    `  🔄 Upshift: ${recommendations.upshiftRecommended ? "✅ YES" : "❌ NO"}`,
  );
  console.log(
    `  🔽 Downshift: ${recommendations.downshiftRecommended ? "✅ YES" : "❌ NO"}`,
  );

  if (recommendations.upshiftRecommended) {
    console.log(
      `  ⚠️  RECOMMENDATION: Shift UP! RPM is at ${frame.rpm} (above ${efficiency?.shiftWindow[1] - 50})`,
    );
  } else if (recommendations.downshiftRecommended) {
    console.log(
      `  ⚠️  RECOMMENDATION: Shift DOWN! RPM is at ${frame.rpm} (below ${efficiency?.shiftWindow[0] + 50})`,
    );
  } else {
    console.log(`  ✅ OPTIMAL: RPM ${frame.rpm} is in efficient range`);
  }
  console.log("");
});

console.log("📊 Final Gear 3 Efficiency Summary:");
const finalMap = generator.getEfficiencyMap();
const gear3Stats = finalMap[3];
if (gear3Stats) {
  console.log(`Gear 3 Optimal Range: ${gear3Stats.rpmOptimal} RPM`);
  console.log(
    `Shift Window: [${gear3Stats.shiftWindow[0]}, ${gear3Stats.shiftWindow[1]}] RPM`,
  );
  console.log(
    `Observed Range: ${gear3Stats.rpmMin} - ${gear3Stats.rpmMax} RPM`,
  );
  console.log(`Average RPM: ${Math.round(gear3Stats.rpmAvg)} RPM`);
}
