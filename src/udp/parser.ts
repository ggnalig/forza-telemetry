// Strict 324-byte Data Out parser - Official Forza Horizon 6 format
// EXACT binary offset mapping per support.forza.net's FH6 "Data Out" doc
// NO FALLBACKS - Use ONLY direct fields as specified

import { TelemetryData, ParsedTelemetryData } from "../types/telemetry";

// EXACT offsets per the official FH6 Data Out documentation
// (support.forza.net/hc/en-us/articles/51744149102611). FH6 shares most of
// its layout with Forza Motorsport's "Dash" format up through numCylinders,
// but then diverges: it inserts carGroup/smashableVelDiff/smashableMass
// (absent from FM) before position, and drops FM's tireWear/trackOrdinal
// tail fields entirely - so this is NOT the same 331-byte struct.
const FH6_DASH_OFFSETS = {
  // HEADER + PHYSICS (0 - 231) - identical layout to FM's Dash format
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

  // Suspension travel (normalized)
  suspensionTravelFL: 68,
  suspensionTravelFR: 72,
  suspensionTravelRL: 76,
  suspensionTravelRR: 80,

  // Tire slip ratios
  tireSlipRatioFL: 84,
  tireSlipRatioFR: 88,
  tireSlipRatioRL: 92,
  tireSlipRatioRR: 96,

  // Wheel rotation speeds
  wheelRotationSpeedFL: 100,
  wheelRotationSpeedFR: 104,
  wheelRotationSpeedRL: 108,
  wheelRotationSpeedRR: 112,

  // Wheel on rumble strip (s32 boolean)
  wheelOnRumbleStripFL: 116,
  wheelOnRumbleStripFR: 120,
  wheelOnRumbleStripRL: 124,
  wheelOnRumbleStripRR: 128,

  // Wheel in puddle - s32 BOOLEAN in FH6 (1 = in puddle, 0 = not), NOT a
  // depth float like FM's equivalent field.
  wheelInPuddleFL: 132,
  wheelInPuddleFR: 136,
  wheelInPuddleRL: 140,
  wheelInPuddleRR: 144,

  // Surface rumble
  surfaceRumbleFL: 148,
  surfaceRumbleFR: 152,
  surfaceRumbleRL: 156,
  surfaceRumbleRR: 160,

  // Tire slip angles
  tireSlipAngleFL: 164,
  tireSlipAngleFR: 168,
  tireSlipAngleRL: 172,
  tireSlipAngleRR: 176,

  // Tire combined slip
  tireCombinedSlipFL: 180,
  tireCombinedSlipFR: 184,
  tireCombinedSlipRL: 188,
  tireCombinedSlipRR: 192,

  // Suspension travel (meters)
  suspensionTravelMetersFL: 196,
  suspensionTravelMetersFR: 200,
  suspensionTravelMetersRL: 204,
  suspensionTravelMetersRR: 208,

  // Car data
  carOrdinal: 212, // s32
  carClass: 216, // s32
  carPerformanceIndex: 220, // s32
  drivetrainType: 224, // s32
  numCylinders: 228, // s32

  // FH6-ONLY fields (not present in FM's Dash format)
  carGroup: 232, // u32: car group identifier
  smashableVelDiff: 236, // f32: velocity loss from smashable collision (m/s)
  smashableMass: 240, // f32: mass of recently hit smashable object (kg)

  // Position/performance (shifted +12 vs FM to make room for the 3 fields above)
  positionX: 244,
  positionY: 248,
  positionZ: 252,
  speed: 256, // f32: m/s - convert to km/h
  power: 260, // f32: watts - convert to kW
  torque: 264, // f32: Nm
  tireTempFL: 268,
  tireTempFR: 272,
  tireTempRL: 276,
  tireTempRR: 280,
  boost: 284, // f32: PSI above atmospheric
  fuel: 288, // f32: 0.0-1.0
  distanceTraveled: 292, // f32: meters
  bestLap: 296, // f32: seconds
  lastLap: 300, // f32: seconds
  currentLap: 304, // f32: seconds
  currentRaceTime: 308, // f32: seconds
  lapNumber: 312, // u16
  racePosition: 314, // u8
  accel: 315, // u8: 0-255
  brake: 316, // u8: 0-255
  clutch: 317, // u8: 0-255
  handbrake: 318, // u8: 0-255
  gear: 319, // u8
  steer: 320, // s8: -127..127
  normalizedDrivingLine: 321, // s8: -127..127
  normalizedAIBrakeDifference: 322, // s8: -127..127
  // Byte 323 is a single trailing pad byte (324 total isn't a multiple of 4
  // without it - every other field is naturally 4-byte aligned) - unused.
};

// Constants
const FH6_DASH_SIZE = 324; // EXACT packet size per the official FH6 doc
const RPM_MIN = 0; // RPM validation range
const RPM_MAX = 15000;
const SPEED_MAX_KMH = 500; // Speed validation range
// Forza's raw speed goes negative while reversing - a tiny negative-float
// jitter at a dead stop shouldn't be read as "reversing", so only treat it
// as such past this threshold (m/s, well under walking pace).
const REVERSE_SPEED_THRESHOLD_MS = 0.1;

export class Fh6TelemetryParser {
  /**
   * Parse a Forza Horizon 6 "Data Out" 324-byte packet with strict validation.
   * NO FALLBACKS - Use ONLY direct fields as specified.
   */
  public parse(buffer: Buffer): ParsedTelemetryData | null {
    // STRICT: Only accept 324-byte packets
    if (buffer.length !== FH6_DASH_SIZE) {
      return null;
    }

    try {
      // Race state check - reject if not racing
      const isRaceOn = buffer.readInt32LE(FH6_DASH_OFFSETS.isRaceOn);
      if (isRaceOn === 0) {
        return null;
      }

      // Parse timestamp
      const timestampMS = buffer.readUInt32LE(FH6_DASH_OFFSETS.timestampMS);

      // Parse engine data
      const engineMaxRpm = buffer.readFloatLE(FH6_DASH_OFFSETS.engineMaxRpm);
      const engineIdleRpm = buffer.readFloatLE(FH6_DASH_OFFSETS.engineIdleRpm);
      const currentEngineRpm = buffer.readFloatLE(
        FH6_DASH_OFFSETS.currentEngineRpm,
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
      const accelerationX = buffer.readFloatLE(FH6_DASH_OFFSETS.accelerationX);
      const accelerationY = buffer.readFloatLE(FH6_DASH_OFFSETS.accelerationY);
      const accelerationZ = buffer.readFloatLE(FH6_DASH_OFFSETS.accelerationZ);

      // Parse velocity data
      const velocityX = buffer.readFloatLE(FH6_DASH_OFFSETS.velocityX);
      const velocityY = buffer.readFloatLE(FH6_DASH_OFFSETS.velocityY);
      const velocityZ = buffer.readFloatLE(FH6_DASH_OFFSETS.velocityZ);

      // Parse angular velocity
      const angularVelocityX = buffer.readFloatLE(
        FH6_DASH_OFFSETS.angularVelocityX,
      );
      const angularVelocityY = buffer.readFloatLE(
        FH6_DASH_OFFSETS.angularVelocityY,
      );
      const angularVelocityZ = buffer.readFloatLE(
        FH6_DASH_OFFSETS.angularVelocityZ,
      );

      // Parse orientation
      const yaw = buffer.readFloatLE(FH6_DASH_OFFSETS.yaw);
      const pitch = buffer.readFloatLE(FH6_DASH_OFFSETS.pitch);
      const roll = buffer.readFloatLE(FH6_DASH_OFFSETS.roll);

      // Parse suspension travel
      const suspensionTravelFL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.suspensionTravelFL,
      );
      const suspensionTravelFR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.suspensionTravelFR,
      );
      const suspensionTravelRL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.suspensionTravelRL,
      );
      const suspensionTravelRR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.suspensionTravelRR,
      );

      // Parse tire slip ratios
      const tireSlipRatioFL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.tireSlipRatioFL,
      );
      const tireSlipRatioFR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.tireSlipRatioFR,
      );
      const tireSlipRatioRL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.tireSlipRatioRL,
      );
      const tireSlipRatioRR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.tireSlipRatioRR,
      );

      // Parse wheel rotation speeds
      const wheelRotationSpeedFL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.wheelRotationSpeedFL,
      );
      const wheelRotationSpeedFR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.wheelRotationSpeedFR,
      );
      const wheelRotationSpeedRL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.wheelRotationSpeedRL,
      );
      const wheelRotationSpeedRR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.wheelRotationSpeedRR,
      );

      // Parse wheel on rumble strip
      const wheelOnRumbleStripFL = buffer.readInt32LE(
        FH6_DASH_OFFSETS.wheelOnRumbleStripFL,
      );
      const wheelOnRumbleStripFR = buffer.readInt32LE(
        FH6_DASH_OFFSETS.wheelOnRumbleStripFR,
      );
      const wheelOnRumbleStripRL = buffer.readInt32LE(
        FH6_DASH_OFFSETS.wheelOnRumbleStripRL,
      );
      const wheelOnRumbleStripRR = buffer.readInt32LE(
        FH6_DASH_OFFSETS.wheelOnRumbleStripRR,
      );

      // Parse wheel in puddle (boolean, not depth - see offsets comment)
      const wheelInPuddleFL = buffer.readInt32LE(
        FH6_DASH_OFFSETS.wheelInPuddleFL,
      );
      const wheelInPuddleFR = buffer.readInt32LE(
        FH6_DASH_OFFSETS.wheelInPuddleFR,
      );
      const wheelInPuddleRL = buffer.readInt32LE(
        FH6_DASH_OFFSETS.wheelInPuddleRL,
      );
      const wheelInPuddleRR = buffer.readInt32LE(
        FH6_DASH_OFFSETS.wheelInPuddleRR,
      );

      // Parse surface rumble
      const surfaceRumbleFL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.surfaceRumbleFL,
      );
      const surfaceRumbleFR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.surfaceRumbleFR,
      );
      const surfaceRumbleRL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.surfaceRumbleRL,
      );
      const surfaceRumbleRR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.surfaceRumbleRR,
      );

      // Parse tire slip angles
      const tireSlipAngleFL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.tireSlipAngleFL,
      );
      const tireSlipAngleFR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.tireSlipAngleFR,
      );
      const tireSlipAngleRL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.tireSlipAngleRL,
      );
      const tireSlipAngleRR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.tireSlipAngleRR,
      );

      // Parse tire combined slip
      const tireCombinedSlipFL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.tireCombinedSlipFL,
      );
      const tireCombinedSlipFR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.tireCombinedSlipFR,
      );
      const tireCombinedSlipRL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.tireCombinedSlipRL,
      );
      const tireCombinedSlipRR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.tireCombinedSlipRR,
      );

      // Parse suspension travel meters
      const suspensionTravelMetersFL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.suspensionTravelMetersFL,
      );
      const suspensionTravelMetersFR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.suspensionTravelMetersFR,
      );
      const suspensionTravelMetersRL = buffer.readFloatLE(
        FH6_DASH_OFFSETS.suspensionTravelMetersRL,
      );
      const suspensionTravelMetersRR = buffer.readFloatLE(
        FH6_DASH_OFFSETS.suspensionTravelMetersRR,
      );

      // Parse car data
      const carOrdinal = buffer.readInt32LE(FH6_DASH_OFFSETS.carOrdinal);
      const carClass = buffer.readInt32LE(FH6_DASH_OFFSETS.carClass);
      const carPerformanceIndex = buffer.readInt32LE(
        FH6_DASH_OFFSETS.carPerformanceIndex,
      );
      const drivetrainType = buffer.readInt32LE(
        FH6_DASH_OFFSETS.drivetrainType,
      );
      const numCylinders = buffer.readInt32LE(FH6_DASH_OFFSETS.numCylinders);
      const carGroup = buffer.readUInt32LE(FH6_DASH_OFFSETS.carGroup);
      const smashableVelDiff = buffer.readFloatLE(
        FH6_DASH_OFFSETS.smashableVelDiff,
      );
      const smashableMass = buffer.readFloatLE(FH6_DASH_OFFSETS.smashableMass);

      // Parse position data
      const positionX = buffer.readFloatLE(FH6_DASH_OFFSETS.positionX);
      const positionY = buffer.readFloatLE(FH6_DASH_OFFSETS.positionY);
      const positionZ = buffer.readFloatLE(FH6_DASH_OFFSETS.positionZ);

      // Parse performance data (NO FALLBACKS - direct fields only)
      const speed = buffer.readFloatLE(FH6_DASH_OFFSETS.speed);
      const power = buffer.readFloatLE(FH6_DASH_OFFSETS.power) / 1000;
      const torque = buffer.readFloatLE(FH6_DASH_OFFSETS.torque);

      // Validate speed and convert to km/h. Forza's raw speed goes NEGATIVE
      // while reversing - the "Gear" byte itself never distinguishes Neutral
      // from Reverse (it reports 0 for both; confirmed by this being the
      // only signed signal available for it). This used to be treated as a
      // malformed packet and dropped entirely, which is why the UI would
      // freeze on stale gear/rpm data (stuck showing "N") for as long as the
      // car stayed in reverse - no new frames ever arrived. Keep the sign
      // just long enough to detect reversing (see `isReversing` below, used
      // for the gear field), then normalize to a plain magnitude here -
      // every other consumer of speedKmh expects it to never be negative.
      if (isNaN(speed)) {
        return null;
      }
      const isReversing = speed < -REVERSE_SPEED_THRESHOLD_MS;
      const speedKmh = Math.abs(speed) * 3.6;
      if (speedKmh > SPEED_MAX_KMH) {
        return null;
      }

      // Parse tire temperatures
      const tireTempFL = buffer.readFloatLE(FH6_DASH_OFFSETS.tireTempFL);
      const tireTempFR = buffer.readFloatLE(FH6_DASH_OFFSETS.tireTempFR);
      const tireTempRL = buffer.readFloatLE(FH6_DASH_OFFSETS.tireTempRL);
      const tireTempRR = buffer.readFloatLE(FH6_DASH_OFFSETS.tireTempRR);

      // Parse additional metrics
      const boost = buffer.readFloatLE(FH6_DASH_OFFSETS.boost);
      const fuel = buffer.readFloatLE(FH6_DASH_OFFSETS.fuel) * 100;
      const distanceTraveled = buffer.readFloatLE(
        FH6_DASH_OFFSETS.distanceTraveled,
      );

      // Parse lap timing data
      const bestLap = buffer.readFloatLE(FH6_DASH_OFFSETS.bestLap);
      const lastLap = buffer.readFloatLE(FH6_DASH_OFFSETS.lastLap);
      const currentLap = buffer.readFloatLE(FH6_DASH_OFFSETS.currentLap);
      const currentRaceTime = buffer.readFloatLE(
        FH6_DASH_OFFSETS.currentRaceTime,
      );

      // Parse race data
      const lapNumber = buffer.readUInt16LE(FH6_DASH_OFFSETS.lapNumber) + 1;
      const racePosition = buffer.readUInt8(FH6_DASH_OFFSETS.racePosition);

      // Parse control inputs (normalize u8 values)
      const throttle = Math.max(
        0,
        Math.min(1, buffer.readUInt8(FH6_DASH_OFFSETS.accel) / 255),
      );
      const brake = Math.max(
        0,
        Math.min(1, buffer.readUInt8(FH6_DASH_OFFSETS.brake) / 255),
      );
      const clutch = Math.max(
        0,
        Math.min(1, buffer.readUInt8(FH6_DASH_OFFSETS.clutch) / 255),
      );
      const handbrake = Math.max(
        0,
        Math.min(1, buffer.readUInt8(FH6_DASH_OFFSETS.handbrake) / 255),
      );

      // Parse gear and steering (keep signed values as specified). The raw
      // gear byte is 0 for both Neutral and Reverse (it's a plain u8, no
      // negative values possible from the game itself) - fold in
      // `isReversing` (derived from speed's sign above) to tell them apart.
      // -1 is a safe sentinel for Reverse since the game never sends it;
      // true Neutral (0) and forward gears (1-10) pass through untouched.
      const rawGear = buffer.readUInt8(FH6_DASH_OFFSETS.gear);
      const gear = rawGear === 0 && isReversing ? -1 : rawGear;
      const steer = buffer.readInt8(FH6_DASH_OFFSETS.steer);

      // Parse AI assistance data (normalize s8 values)
      const normalizedDrivingLine =
        buffer.readInt8(FH6_DASH_OFFSETS.normalizedDrivingLine) / 127;
      const normalizedAIBrakeDifference =
        buffer.readInt8(FH6_DASH_OFFSETS.normalizedAIBrakeDifference) / 127;

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
          inPuddle: {
            frontLeft: wheelInPuddleFL,
            frontRight: wheelInPuddleFR,
            rearLeft: wheelInPuddleRL,
            rearRight: wheelInPuddleRR,
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
        },

        car: {
          ordinal: carOrdinal,
          class: carClass,
          performanceIndex: carPerformanceIndex,
          drivetrain: drivetrainType,
          group: carGroup,
        },

        collision: {
          smashableVelDiff: smashableVelDiff,
          smashableMass: smashableMass,
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

        distanceTraveled: distanceTraveled,

        ai: {
          normalizedDrivingLine: normalizedDrivingLine,
          normalizedAIBrakeDifference: normalizedAIBrakeDifference,
        },
      };

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
   * Enable/disable debug mode (placeholder for future use)
   */
  public setDebugMode(_enabled: boolean): void {
    // Debug mode functionality can be added here if needed
  }

  /**
   * Get current offsets for debugging
   */
  public getOffsets(): Readonly<typeof FH6_DASH_OFFSETS> {
    return { ...FH6_DASH_OFFSETS };
  }
}

// Export singleton instance
export const fh6TelemetryParser = new Fh6TelemetryParser();
