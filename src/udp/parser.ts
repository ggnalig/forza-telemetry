// Strict 331-byte Car Dash Parser - Official Forza Motorsport format
// EXACT binary offset mapping for FULL 331-byte format with extended data
// NO FALLBACKS - Use ONLY direct fields as specified

import { TelemetryData, ParsedTelemetryData } from "../types/telemetry";

// EXACT official offsets for FULL Car Dash 331-byte format
const CAR_DASH_OFFSETS = {
  // HEADER + PHYSICS (0 - 232)
  isRaceOn: 0, // s32: race state
  timestampMS: 4, // u32: timestamp in milliseconds
  engineMaxRpm: 8, // f32: engine max RPM
  engineIdleRpm: 12, // f32: engine idle RPM
  currentEngineRpm: 16, // f32: current engine RPM

  // Motion data
  accelerationX: 20, // f32: X acceleration
  accelerationY: 24, // f32: Y acceleration
  accelerationZ: 28, // f32: Z acceleration
  velocityX: 32, // f32: X velocity
  velocityY: 36, // f32: Y velocity
  velocityZ: 40, // f32: Z velocity
  angularVelocityX: 44, // f32: X angular velocity
  angularVelocityY: 48, // f32: Y angular velocity
  angularVelocityZ: 52, // f32: Z angular velocity
  yaw: 56, // f32: yaw angle
  pitch: 60, // f32: pitch angle
  roll: 64, // f32: roll angle

  // Suspension travel
  suspensionTravelFL: 68, // f32: front left suspension travel
  suspensionTravelFR: 72, // f32: front right suspension travel
  suspensionTravelRL: 76, // f32: rear left suspension travel
  suspensionTravelRR: 80, // f32: rear right suspension travel

  // Tire slip ratios
  tireSlipRatioFL: 84, // f32: front left tire slip ratio
  tireSlipRatioFR: 88, // f32: front right tire slip ratio
  tireSlipRatioRL: 92, // f32: rear left tire slip ratio
  tireSlipRatioRR: 96, // f32: rear right tire slip ratio

  // Wheel rotation speeds
  wheelRotationSpeedFL: 100, // f32: front left wheel rotation speed
  wheelRotationSpeedFR: 104, // f32: front right wheel rotation speed
  wheelRotationSpeedRL: 108, // f32: rear left wheel rotation speed
  wheelRotationSpeedRR: 112, // f32: rear right wheel rotation speed

  // Wheel on rumble strip
  wheelOnRumbleStripFL: 116, // s32: front left on rumble strip
  wheelOnRumbleStripFR: 120, // s32: front right on rumble strip
  wheelOnRumbleStripRL: 124, // s32: rear left on rumble strip
  wheelOnRumbleStripRR: 128, // s32: rear right on rumble strip

  // Wheel in puddle depth
  wheelInPuddleDepthFL: 132, // f32: front left puddle depth
  wheelInPuddleDepthFR: 136, // f32: front right puddle depth
  wheelInPuddleDepthRL: 140, // f32: rear left puddle depth
  wheelInPuddleDepthRR: 144, // f32: rear right puddle depth

  // Surface rumble
  surfaceRumbleFL: 148, // f32: front left surface rumble
  surfaceRumbleFR: 152, // f32: front right surface rumble
  surfaceRumbleRL: 156, // f32: rear left surface rumble
  surfaceRumbleRR: 160, // f32: rear right surface rumble

  // Tire slip angles
  tireSlipAngleFL: 164, // f32: front left tire slip angle
  tireSlipAngleFR: 168, // f32: front right tire slip angle
  tireSlipAngleRL: 172, // f32: rear left tire slip angle
  tireSlipAngleRR: 176, // f32: rear right tire slip angle

  // Tire combined slip
  tireCombinedSlipFL: 180, // f32: front left combined slip
  tireCombinedSlipFR: 184, // f32: front right combined slip
  tireCombinedSlipRL: 188, // f32: rear left combined slip
  tireCombinedSlipRR: 192, // f32: rear right combined slip

  // Suspension travel meters
  suspensionTravelMetersFL: 196, // f32: front left suspension travel (meters)
  suspensionTravelMetersFR: 200, // f32: front right suspension travel (meters)
  suspensionTravelMetersRL: 204, // f32: rear left suspension travel (meters)
  suspensionTravelMetersRR: 208, // f32: rear right suspension travel (meters)

  // Car data
  carOrdinal: 212, // s32: car ordinal
  carClass: 216, // s32: car class
  carPerformanceIndex: 220, // s32: car performance index
  drivetrainType: 224, // s32: drivetrain type
  numCylinders: 228, // s32: number of cylinders

  // DASH EXTENSION (232 - 331)
  positionX: 232, // f32: X position in world
  positionY: 236, // f32: Y position in world
  positionZ: 240, // f32: Z position in world
  speed: 244, // f32: speed (m/s) - convert to km/h
  power: 248, // f32: power (kW)
  torque: 252, // f32: torque (Nm)
  tireTempFL: 256, // f32: front left tire temperature
  tireTempFR: 260, // f32: front right tire temperature
  tireTempRL: 264, // f32: rear left tire temperature
  tireTempRR: 268, // f32: rear right tire temperature
  boost: 272, // f32: boost pressure
  fuel: 276, // f32: fuel level
  distanceTraveled: 280, // f32: distance traveled
  bestLap: 284, // f32: best lap time
  lastLap: 288, // f32: last lap time
  currentLap: 292, // f32: current lap time
  currentRaceTime: 296, // f32: current race time
  lapNumber: 300, // u16: current lap number
  racePosition: 302, // u8: current race position
  accel: 303, // u8: accelerator position
  brake: 304, // u8: brake position
  clutch: 305, // u8: clutch position
  handbrake: 306, // u8: handbrake position
  gear: 307, // u8: current gear
  steer: 308, // s8: steering input
  normalizedDrivingLine: 309, // s8: normalized driving line
  normalizedAIBrakeDifference: 310, // s8: normalized AI brake difference
  tireWearFL: 311, // f32: front left tire wear
  tireWearFR: 315, // f32: front right tire wear
  tireWearRL: 319, // f32: rear left tire wear
  tireWearRR: 323, // f32: rear right tire wear
  trackOrdinal: 327, // s32: track ordinal
};

// Constants
const CAR_DASH_SIZE = 331; // EXACT packet size
const RPM_MIN = 0; // RPM validation range
const RPM_MAX = 15000;
const SPEED_MAX_KMH = 500; // Speed validation range

export class CarDash331Parser {
  private lastLogTime = 0;
  private readonly LOG_INTERVAL = 500; // 500ms rate limit

  /**
   * Parse FULL Car Dash 331-byte format with strict validation
   * NO FALLBACKS - Use ONLY direct fields as specified
   */
  public parse(buffer: Buffer): ParsedTelemetryData | null {
    // STRICT: Only accept 331-byte packets
    if (buffer.length !== CAR_DASH_SIZE) {
      return null;
    }

    try {
      // Race state check - reject if not racing
      const isRaceOn = buffer.readInt32LE(CAR_DASH_OFFSETS.isRaceOn);
      if (isRaceOn === 0) {
        return null;
      }

      // Parse timestamp
      const timestampMS = buffer.readUInt32LE(CAR_DASH_OFFSETS.timestampMS);

      // Parse engine data
      const engineMaxRpm = buffer.readFloatLE(CAR_DASH_OFFSETS.engineMaxRpm);
      const engineIdleRpm = buffer.readFloatLE(CAR_DASH_OFFSETS.engineIdleRpm);
      const currentEngineRpm = buffer.readFloatLE(
        CAR_DASH_OFFSETS.currentEngineRpm,
      );

      // Validate RPM ranges
      if (
        isNaN(currentEngineRpm) ||
        currentEngineRpm < RPM_MIN ||
        currentEngineRpm > RPM_MAX
      ) {
        return null;
      }

      // Parse motion data (acceleration)
      const accelerationX = buffer.readFloatLE(CAR_DASH_OFFSETS.accelerationX);
      const accelerationY = buffer.readFloatLE(CAR_DASH_OFFSETS.accelerationY);
      const accelerationZ = buffer.readFloatLE(CAR_DASH_OFFSETS.accelerationZ);

      // Parse velocity data
      const velocityX = buffer.readFloatLE(CAR_DASH_OFFSETS.velocityX);
      const velocityY = buffer.readFloatLE(CAR_DASH_OFFSETS.velocityY);
      const velocityZ = buffer.readFloatLE(CAR_DASH_OFFSETS.velocityZ);

      // Parse angular velocity
      const angularVelocityX = buffer.readFloatLE(
        CAR_DASH_OFFSETS.angularVelocityX,
      );
      const angularVelocityY = buffer.readFloatLE(
        CAR_DASH_OFFSETS.angularVelocityY,
      );
      const angularVelocityZ = buffer.readFloatLE(
        CAR_DASH_OFFSETS.angularVelocityZ,
      );

      // Parse orientation
      const yaw = buffer.readFloatLE(CAR_DASH_OFFSETS.yaw);
      const pitch = buffer.readFloatLE(CAR_DASH_OFFSETS.pitch);
      const roll = buffer.readFloatLE(CAR_DASH_OFFSETS.roll);

      // Parse suspension travel
      const suspensionTravelFL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.suspensionTravelFL,
      );
      const suspensionTravelFR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.suspensionTravelFR,
      );
      const suspensionTravelRL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.suspensionTravelRL,
      );
      const suspensionTravelRR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.suspensionTravelRR,
      );

      // Parse tire slip ratios
      const tireSlipRatioFL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.tireSlipRatioFL,
      );
      const tireSlipRatioFR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.tireSlipRatioFR,
      );
      const tireSlipRatioRL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.tireSlipRatioRL,
      );
      const tireSlipRatioRR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.tireSlipRatioRR,
      );

      // Parse wheel rotation speeds
      const wheelRotationSpeedFL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.wheelRotationSpeedFL,
      );
      const wheelRotationSpeedFR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.wheelRotationSpeedFR,
      );
      const wheelRotationSpeedRL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.wheelRotationSpeedRL,
      );
      const wheelRotationSpeedRR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.wheelRotationSpeedRR,
      );

      // Parse wheel on rumble strip
      const wheelOnRumbleStripFL = buffer.readInt32LE(
        CAR_DASH_OFFSETS.wheelOnRumbleStripFL,
      );
      const wheelOnRumbleStripFR = buffer.readInt32LE(
        CAR_DASH_OFFSETS.wheelOnRumbleStripFR,
      );
      const wheelOnRumbleStripRL = buffer.readInt32LE(
        CAR_DASH_OFFSETS.wheelOnRumbleStripRL,
      );
      const wheelOnRumbleStripRR = buffer.readInt32LE(
        CAR_DASH_OFFSETS.wheelOnRumbleStripRR,
      );

      // Parse wheel in puddle depth
      const wheelInPuddleDepthFL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.wheelInPuddleDepthFL,
      );
      const wheelInPuddleDepthFR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.wheelInPuddleDepthFR,
      );
      const wheelInPuddleDepthRL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.wheelInPuddleDepthRL,
      );
      const wheelInPuddleDepthRR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.wheelInPuddleDepthRR,
      );

      // Parse surface rumble
      const surfaceRumbleFL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.surfaceRumbleFL,
      );
      const surfaceRumbleFR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.surfaceRumbleFR,
      );
      const surfaceRumbleRL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.surfaceRumbleRL,
      );
      const surfaceRumbleRR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.surfaceRumbleRR,
      );

      // Parse tire slip angles
      const tireSlipAngleFL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.tireSlipAngleFL,
      );
      const tireSlipAngleFR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.tireSlipAngleFR,
      );
      const tireSlipAngleRL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.tireSlipAngleRL,
      );
      const tireSlipAngleRR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.tireSlipAngleRR,
      );

      // Parse tire combined slip
      const tireCombinedSlipFL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.tireCombinedSlipFL,
      );
      const tireCombinedSlipFR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.tireCombinedSlipFR,
      );
      const tireCombinedSlipRL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.tireCombinedSlipRL,
      );
      const tireCombinedSlipRR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.tireCombinedSlipRR,
      );

      // Parse suspension travel meters
      const suspensionTravelMetersFL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.suspensionTravelMetersFL,
      );
      const suspensionTravelMetersFR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.suspensionTravelMetersFR,
      );
      const suspensionTravelMetersRL = buffer.readFloatLE(
        CAR_DASH_OFFSETS.suspensionTravelMetersRL,
      );
      const suspensionTravelMetersRR = buffer.readFloatLE(
        CAR_DASH_OFFSETS.suspensionTravelMetersRR,
      );

      // Parse car data
      const carOrdinal = buffer.readInt32LE(CAR_DASH_OFFSETS.carOrdinal);
      const carClass = buffer.readInt32LE(CAR_DASH_OFFSETS.carClass);
      const carPerformanceIndex = buffer.readInt32LE(
        CAR_DASH_OFFSETS.carPerformanceIndex,
      );
      const drivetrainType = buffer.readInt32LE(
        CAR_DASH_OFFSETS.drivetrainType,
      );
      const numCylinders = buffer.readInt32LE(CAR_DASH_OFFSETS.numCylinders);

      // Parse position data
      const positionX = buffer.readFloatLE(CAR_DASH_OFFSETS.positionX);
      const positionY = buffer.readFloatLE(CAR_DASH_OFFSETS.positionY);
      const positionZ = buffer.readFloatLE(CAR_DASH_OFFSETS.positionZ);

      // Parse performance data (NO FALLBACKS - direct fields only)
      const speed = buffer.readFloatLE(CAR_DASH_OFFSETS.speed);
      const power = buffer.readFloatLE(CAR_DASH_OFFSETS.power);
      const torque = buffer.readFloatLE(CAR_DASH_OFFSETS.torque);

      // Validate speed and convert to km/h
      if (isNaN(speed) || speed < 0) {
        return null;
      }
      const speedKmh = speed * 3.6;
      if (speedKmh > SPEED_MAX_KMH) {
        return null;
      }

      // Parse tire temperatures
      const tireTempFL = buffer.readFloatLE(CAR_DASH_OFFSETS.tireTempFL);
      const tireTempFR = buffer.readFloatLE(CAR_DASH_OFFSETS.tireTempFR);
      const tireTempRL = buffer.readFloatLE(CAR_DASH_OFFSETS.tireTempRL);
      const tireTempRR = buffer.readFloatLE(CAR_DASH_OFFSETS.tireTempRR);

      // Parse additional metrics
      const boost = buffer.readFloatLE(CAR_DASH_OFFSETS.boost);
      const fuel = buffer.readFloatLE(CAR_DASH_OFFSETS.fuel);
      const distanceTraveled = buffer.readFloatLE(
        CAR_DASH_OFFSETS.distanceTraveled,
      );

      // Parse lap timing data
      const bestLap = buffer.readFloatLE(CAR_DASH_OFFSETS.bestLap);
      const lastLap = buffer.readFloatLE(CAR_DASH_OFFSETS.lastLap);
      const currentLap = buffer.readFloatLE(CAR_DASH_OFFSETS.currentLap);
      const currentRaceTime = buffer.readFloatLE(
        CAR_DASH_OFFSETS.currentRaceTime,
      );

      // Parse race data
      const lapNumber = buffer.readUInt16LE(CAR_DASH_OFFSETS.lapNumber);
      const racePosition = buffer.readUInt8(CAR_DASH_OFFSETS.racePosition);

      // Parse control inputs (normalize u8 values)
      const throttle = Math.max(
        0,
        Math.min(1, buffer.readUInt8(CAR_DASH_OFFSETS.accel) / 255),
      );
      const brake = Math.max(
        0,
        Math.min(1, buffer.readUInt8(CAR_DASH_OFFSETS.brake) / 255),
      );
      const clutch = Math.max(
        0,
        Math.min(1, buffer.readUInt8(CAR_DASH_OFFSETS.clutch) / 255),
      );
      const handbrake = Math.max(
        0,
        Math.min(1, buffer.readUInt8(CAR_DASH_OFFSETS.handbrake) / 255),
      );

      // Parse gear and steering (keep signed values as specified)
      const gear = buffer.readUInt8(CAR_DASH_OFFSETS.gear);
      const steer = buffer.readInt8(CAR_DASH_OFFSETS.steer);

      // Parse AI assistance data (normalize s8 values)
      const normalizedDrivingLine =
        buffer.readInt8(CAR_DASH_OFFSETS.normalizedDrivingLine) / 127;
      const normalizedAIBrakeDifference =
        buffer.readInt8(CAR_DASH_OFFSETS.normalizedAIBrakeDifference) / 127;

      // Parse tire wear data
      const tireWearFL = buffer.readFloatLE(CAR_DASH_OFFSETS.tireWearFL);
      const tireWearFR = buffer.readFloatLE(CAR_DASH_OFFSETS.tireWearFR);
      const tireWearRL = buffer.readFloatLE(CAR_DASH_OFFSETS.tireWearRL);
      const tireWearRR = buffer.readFloatLE(CAR_DASH_OFFSETS.tireWearRR);

      // Parse track data
      const trackOrdinal = buffer.readInt32LE(CAR_DASH_OFFSETS.trackOrdinal);

      // Create structured telemetry data object as specified
      const telemetry: TelemetryData = {
        isRaceOn: isRaceOn,
        timestamp: timestampMS,

        engine: {
          rpm: currentEngineRpm,
          maxRpm: engineMaxRpm,
          idleRpm: engineIdleRpm,
          cylinders: numCylinders,
        },

        motion: {
          acceleration: {
            x: accelerationX,
            y: accelerationY,
            z: accelerationZ,
          },
          velocity: {
            x: velocityX,
            y: velocityY,
            z: velocityZ,
          },
          angularVelocity: {
            x: angularVelocityX,
            y: angularVelocityY,
            z: angularVelocityZ,
          },
          orientation: {
            yaw: yaw,
            pitch: pitch,
            roll: roll,
          },
        },

        wheels: {
          slipRatio: {
            frontLeft: tireSlipRatioFL,
            frontRight: tireSlipRatioFR,
            rearLeft: tireSlipRatioRL,
            rearRight: tireSlipRatioRR,
          },
          slipAngle: {
            frontLeft: tireSlipAngleFL,
            frontRight: tireSlipAngleFR,
            rearLeft: tireSlipAngleRL,
            rearRight: tireSlipAngleRR,
          },
          combinedSlip: {
            frontLeft: tireCombinedSlipFL,
            frontRight: tireCombinedSlipFR,
            rearLeft: tireCombinedSlipRL,
            rearRight: tireCombinedSlipRR,
          },
          rotationSpeed: {
            frontLeft: wheelRotationSpeedFL,
            frontRight: wheelRotationSpeedFR,
            rearLeft: wheelRotationSpeedRL,
            rearRight: wheelRotationSpeedRR,
          },
          suspensionTravel: {
            frontLeft: suspensionTravelFL,
            frontRight: suspensionTravelFR,
            rearLeft: suspensionTravelRL,
            rearRight: suspensionTravelRR,
          },
          suspensionMeters: {
            frontLeft: suspensionTravelMetersFL,
            frontRight: suspensionTravelMetersFR,
            rearLeft: suspensionTravelMetersRL,
            rearRight: suspensionTravelMetersRR,
          },
          onRumbleStrip: {
            frontLeft: wheelOnRumbleStripFL,
            frontRight: wheelOnRumbleStripFR,
            rearLeft: wheelOnRumbleStripRL,
            rearRight: wheelOnRumbleStripRR,
          },
          inPuddleDepth: {
            frontLeft: wheelInPuddleDepthFL,
            frontRight: wheelInPuddleDepthFR,
            rearLeft: wheelInPuddleDepthRL,
            rearRight: wheelInPuddleDepthRR,
          },
          surfaceRumble: {
            frontLeft: surfaceRumbleFL,
            frontRight: surfaceRumbleFR,
            rearLeft: surfaceRumbleRL,
            rearRight: surfaceRumbleRR,
          },
          tireTemp: {
            frontLeft: tireTempFL,
            frontRight: tireTempFR,
            rearLeft: tireTempRL,
            rearRight: tireTempRR,
          },
          tireWear: {
            frontLeft: tireWearFL,
            frontRight: tireWearFR,
            rearLeft: tireWearRL,
            rearRight: tireWearRR,
          },
        },

        car: {
          ordinal: carOrdinal,
          class: carClass,
          performanceIndex: carPerformanceIndex,
          drivetrain: drivetrainType,
        },

        position: {
          x: positionX,
          y: positionY,
          z: positionZ,
        },

        performance: {
          speedKmh: speedKmh,
          powerKw: power,
          torqueNm: torque,
          boost: boost,
          fuel: fuel,
        },

        lap: {
          current: currentLap,
          last: lastLap,
          best: bestLap,
          number: lapNumber,
          raceTime: currentRaceTime,
          position: racePosition,
        },

        input: {
          throttle: throttle,
          brake: brake,
          clutch: clutch,
          handbrake: handbrake,
          gear: gear,
          steer: steer,
        },

        track: {
          ordinal: trackOrdinal,
          distanceTraveled: distanceTraveled,
        },

        ai: {
          normalizedDrivingLine: normalizedDrivingLine,
          normalizedAIBrakeDifference: normalizedAIBrakeDifference,
        },
      };

      // Mandatory logging every 500ms
      this.logTelemetry(telemetry);

      return {
        raw: buffer,
        parsed: telemetry,
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Mandatory logging every 500ms
   */
  private logTelemetry(data: TelemetryData): void {
    const now = Date.now();
    if (now - this.lastLogTime < this.LOG_INTERVAL) {
      return;
    }

    // Telemetry Snapshot format with key performance metrics
    const snapshot = `Telemetry Snapshot: Speed: ${Math.round(data.performance.speedKmh)} km/h, RPM: ${Math.round(data.engine.rpm)}, Gear: ${data.input.gear}, Throttle: ${Math.round(data.input.throttle * 100)} %, Brake: ${Math.round(data.input.brake * 100)} %, Torque: ${Math.round(data.performance.torqueNm)} Nm, Power: ${Math.round(data.performance.powerKw)} kW, Boost: ${data.performance.boost.toFixed(1)} bar, Fuel: ${Math.round(data.performance.fuel)} %, Lap: ${data.lap.number}`;

    console.log(snapshot);
    this.lastLogTime = now;
  }

  /**
   * Enable/disable debug mode (placeholder for future use)
   */
  public setDebugMode(_enabled: boolean): void {
    // Debug mode functionality can be added here if needed
  }

  /**
   * Get current offsets for debugging
   */
  public getOffsets(): Readonly<typeof CAR_DASH_OFFSETS> {
    return { ...CAR_DASH_OFFSETS };
  }
}

// Export singleton instance
export const carDash331Parser = new CarDash331Parser();
