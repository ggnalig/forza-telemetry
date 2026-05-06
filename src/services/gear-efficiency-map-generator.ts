export interface TelemetryFrame {
  gear: number;
  rpm: number;
  speed: number;
  torque: number;
}

export interface GearEfficiencyStats {
  rpmMin: number;
  rpmMax: number;
  rpmAvg: number;
  rpmOptimal: number;
  shiftWindow: [number, number];
}

export interface GearEfficiencyMap {
  [gear: number]: GearEfficiencyStats;
}

export interface ShiftRecommendations {
  upshiftRecommended: boolean;
  downshiftRecommended: boolean;
}

export class GearEfficiencyMapGenerator {
  private efficiencyMap: GearEfficiencyMap = {};
  private sampleCounts: { [gear: number]: number } = {};
  private lastSpeedByGear: { [gear: number]: number } = {};
  private efficiencyScoreByRpm: { [gear: number]: { [rpmBucket: number]: number } } = {};
  private readonly WINDOW_MARGIN = 250;
  private readonly RPM_BUCKET_SIZE = 100;
  private readonly MIN_SAMPLES = 5;

  update(frame: TelemetryFrame): { efficiencyMap: GearEfficiencyMap; shiftRecommendations: ShiftRecommendations } {
    const { gear, rpm, speed } = frame;
    
    if (!this.efficiencyMap[gear]) {
      this.efficiencyMap[gear] = {
        rpmMin: rpm,
        rpmMax: rpm,
        rpmAvg: rpm,
        rpmOptimal: rpm,
        shiftWindow: [rpm - this.WINDOW_MARGIN, rpm + this.WINDOW_MARGIN]
      };
      this.sampleCounts[gear] = 1;
      this.lastSpeedByGear[gear] = speed;
      this.efficiencyScoreByRpm[gear] = {};
      return {
        efficiencyMap: this.efficiencyMap,
        shiftRecommendations: { upshiftRecommended: false, downshiftRecommended: false }
      };
    }

    const currentStats = this.efficiencyMap[gear];
    const currentCount = this.sampleCounts[gear];
    const lastSpeed = this.lastSpeedByGear[gear];

    currentStats.rpmMin = Math.min(currentStats.rpmMin, rpm);
    currentStats.rpmMax = Math.max(currentStats.rpmMax, rpm);
    currentStats.rpmAvg = (currentStats.rpmAvg * currentCount + rpm) / (currentCount + 1);

    const speedGain = Math.max(0, speed - lastSpeed);
    const rpmBucket = Math.floor(rpm / this.RPM_BUCKET_SIZE) * this.RPM_BUCKET_SIZE;
    
    if (!this.efficiencyScoreByRpm[gear][rpmBucket]) {
      this.efficiencyScoreByRpm[gear][rpmBucket] = 0;
    }
    this.efficiencyScoreByRpm[gear][rpmBucket] += speedGain;

    if (currentCount >= this.MIN_SAMPLES) {
      const rpmBuckets = Object.keys(this.efficiencyScoreByRpm[gear]).map(Number);
      if (rpmBuckets.length > 1) {
        let bestBucket = rpmBuckets[0];
        let bestScore = this.efficiencyScoreByRpm[gear][bestBucket];
        
        for (const bucket of rpmBuckets) {
          const score = this.efficiencyScoreByRpm[gear][bucket];
          if (score > bestScore) {
            bestScore = score;
            bestBucket = bucket;
          }
        }
        
        currentStats.rpmOptimal = bestBucket + this.RPM_BUCKET_SIZE / 2;
        currentStats.shiftWindow = [
          Math.max(currentStats.rpmMin, currentStats.rpmOptimal - this.WINDOW_MARGIN),
          Math.min(currentStats.rpmMax, currentStats.rpmOptimal + this.WINDOW_MARGIN)
        ];
      }
    }

    this.sampleCounts[gear] = currentCount + 1;
    this.lastSpeedByGear[gear] = speed;

    const shiftRecommendations = this.calculateShiftRecommendations(gear, rpm);

    return {
      efficiencyMap: this.efficiencyMap,
      shiftRecommendations
    };
  }

  private calculateShiftRecommendations(gear: number, rpm: number): ShiftRecommendations {
    const stats = this.efficiencyMap[gear];
    if (!stats || this.sampleCounts[gear] < this.MIN_SAMPLES) {
      return { upshiftRecommended: false, downshiftRecommended: false };
    }

    const [windowMin, windowMax] = stats.shiftWindow;
    const upshiftThreshold = windowMax - 50;
    const downshiftThreshold = windowMin + 50;

    return {
      upshiftRecommended: rpm >= upshiftThreshold,
      downshiftRecommended: rpm <= downshiftThreshold
    };
  }

  getEfficiencyMap(): GearEfficiencyMap {
    return { ...this.efficiencyMap };
  }

  reset(): void {
    this.efficiencyMap = {};
    this.sampleCounts = {};
    this.lastSpeedByGear = {};
    this.efficiencyScoreByRpm = {};
  }
}