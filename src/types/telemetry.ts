// Data Out 324-byte telemetry data types - Official Forza Horizon 6 format
// All offsets and field types match support.forza.net's FH6 Data Out spec
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
    // Boolean flag (1/0) in FH6 - NOT a depth value (FM's equivalent field is
    // a float depth; FH6's Data Out doc explicitly types this s32/boolean).
    inPuddle: {
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
  };

  // Car data
  car: {
    ordinal: number;
    class: number;
    performanceIndex: number;
    drivetrain: number;
    group: number; // FH6-only: car group identifier
  };

  // FH6-only: collision data absent from FM's Dash format
  collision: {
    smashableVelDiff: number; // velocity loss from smashable object collision (m/s)
    smashableMass: number; // mass of recently hit smashable object (kg)
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

  // FH6 doesn't include a TrackOrdinal field (present in FM's Dash format)
  distanceTraveled: number;

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
  // The manually-entered GearboxTune active for this car, if any - see
  // src/services/gearbox-tune-store.ts. Null means gear ratios are coming
  // from GearRatioEstimator's statistical estimate instead.
  activeTune: {
    id: string;
    carOrdinal: number;
    name: string;
    gearRatios: Record<number, number>;
    createdAt: string;
    updatedAt: string;
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
    // Highest rpm ever observed at WOT for this car build - see
    // RpmCeilingTracker. A diagnostic for cross-checking engine.maxRpm
    // against the actual empirically-observed rev limiter.
    observedRpmCeiling?: number;
  };
}
