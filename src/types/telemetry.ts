// Car Dash 331-byte telemetry data types - Official Forza Motorsport format
// All offsets and field types match official specification
// FULL implementation with extended data as per specification

export interface TelemetryData {
  // Core race state
  isRaceOn: number;
  timestamp: number;

  // Engine data
  engine: {
    rpm: number;
    maxRpm: number;
    idleRpm: number;
    cylinders: number;
  };

  // Motion data
  motion: {
    acceleration: {
      x: number;
      y: number;
      z: number;
    };
    velocity: {
      x: number;
      y: number;
      z: number;
    };
    angularVelocity: {
      x: number;
      y: number;
      z: number;
    };
    orientation: {
      yaw: number;
      pitch: number;
      roll: number;
    };
  };

  // Wheel data
  wheels: {
    slipRatio: {
      frontLeft: number;
      frontRight: number;
      rearLeft: number;
      rearRight: number;
    };
    slipAngle: {
      frontLeft: number;
      frontRight: number;
      rearLeft: number;
      rearRight: number;
    };
    combinedSlip: {
      frontLeft: number;
      frontRight: number;
      rearLeft: number;
      rearRight: number;
    };
    rotationSpeed: {
      frontLeft: number;
      frontRight: number;
      rearLeft: number;
      rearRight: number;
    };
    suspensionTravel: {
      frontLeft: number;
      frontRight: number;
      rearLeft: number;
      rearRight: number;
    };
    suspensionMeters: {
      frontLeft: number;
      frontRight: number;
      rearLeft: number;
      rearRight: number;
    };
    onRumbleStrip: {
      frontLeft: number;
      frontRight: number;
      rearLeft: number;
      rearRight: number;
    };
    inPuddleDepth: {
      frontLeft: number;
      frontRight: number;
      rearLeft: number;
      rearRight: number;
    };
    surfaceRumble: {
      frontLeft: number;
      frontRight: number;
      rearLeft: number;
      rearRight: number;
    };
    tireTemp: {
      frontLeft: number;
      frontRight: number;
      rearLeft: number;
      rearRight: number;
    };
    tireWear: {
      frontLeft: number;
      frontRight: number;
      rearLeft: number;
      rearRight: number;
    };
  };

  // Car data
  car: {
    ordinal: number;
    class: number;
    performanceIndex: number;
    drivetrain: number;
  };

  // Position data
  position: {
    x: number;
    y: number;
    z: number;
  };

  // Performance data
  performance: {
    speedKmh: number;
    powerKw: number;
    torqueNm: number;
    boost: number;
    fuel: number;
  };

  // Lap data
  lap: {
    current: number;
    last: number;
    best: number;
    number: number;
    raceTime: number;
    position: number;
  };

  // Input data
  input: {
    throttle: number;
    brake: number;
    clutch: number;
    handbrake: number;
    gear: number;
    steer: number;
  };

  // Track data
  track: {
    ordinal: number;
    distanceTraveled: number;
  };

  // AI assistance data
  ai: {
    normalizedDrivingLine: number;
    normalizedAIBrakeDifference: number;
  };
}

export interface ParsedTelemetryData {
  raw: Buffer;
  parsed: TelemetryData;
  timestamp: number;
}

export interface ProcessedTelemetryData {
  raw: Buffer;
  parsed: TelemetryData;
  timestamp: number;
  carInfo: {
    carId: number;
    year: number;
    make: string;
    model: string;
    displayName: string;
  } | null;
  efficiency?: {
    map: {
      [gear: number]: {
        rpmMin: number;
        rpmMax: number;
        rpmAvg: number;
        rpmOptimal: number;
        observedRpmRange: [number, number];
      };
    };
    recommendations?: {
      upshiftRecommended: boolean;
      downshiftRecommended: boolean;
    };
    lights?: string[];
    currentRpm?: number;
    finalShiftRPM?: number;
  };
}
