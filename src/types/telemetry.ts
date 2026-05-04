// Car Dash 331-byte telemetry data types - Official Forza Motorsport format
// All offsets and field types match official specification

export interface TelemetryData {
  // Core telemetry fields
  speed: number; // km/h (calculated from velocity or direct field)
  rpm: number; // engine RPM
  gear: number; // current gear (-1=reverse, 0=neutral, 1-10=forward)
  throttle: number; // 0-1 normalized (Accel / 255)
  brake: number; // 0-1 normalized (Brake / 255)
  clutch: number; // 0-1 normalized (Clutch / 255)
  handbrake: number; // 0-1 normalized (HandBrake / 255)
  steer: number; // -1 to 1 normalized (Steer / 127)

  // Position data
  positionX: number; // X position in world
  positionY: number; // Y position in world
  positionZ: number; // Z position in world

  // Velocity components (for fallback calculation)
  velocityX: number; // X velocity (m/s)
  velocityY: number; // Y velocity (m/s)
  velocityZ: number; // Z velocity (m/s)

  // Performance metrics
  power: number; // engine power (kW)
  torque: number; // engine torque (Nm)
  boost: number; // turbo boost (bar)
  fuel: number; // fuel level (0-100%)

  // Lap timing data
  bestLap: number; // best lap time (seconds)
  lastLap: number; // last lap time (seconds)
  currentLap: number; // current lap time (seconds)
  currentRaceTime: number; // current race time (seconds)
  lapNumber: number; // current lap number
  racePosition: number; // current race position
  distanceTraveled: number; // distance traveled (meters)

  // Tire temperatures
  tireTempFrontLeft: number; // front left tire temp (°C)
  tireTempFrontRight: number; // front right tire temp (°C)
  tireTempRearLeft: number; // rear left tire temp (°C)
  tireTempRearRight: number; // rear right tire temp (°C)

  // AI assistance data
  normalizedDrivingLine: number; // -1 to 1 normalized
  normalizedAIBrakeDifference: number; // -1 to 1 normalized

  // Race state
  isRaceOn: number; // 1=racing, 0=not racing
}

export interface ParsedTelemetryData {
  raw: Buffer;
  parsed: TelemetryData;
  timestamp: number;
  debugInfo?: {
    speedSource: "direct" | "velocity_fallback" | "error";
    rawSpeed?: number;
    computedSpeed?: number;
    velocityComponents?: { vx: number; vy: number; vz: number };
  };
}

export interface ProcessedTelemetryData {
  raw: Buffer;
  parsed: TelemetryData;
  timestamp: number;
}
