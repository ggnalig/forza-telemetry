// Strict 331-byte Car Dash Parser - Official Forza Motorsport format
// EXACT binary offset mapping with velocity-based speed calculation

import { TelemetryData, ParsedTelemetryData } from "../types/telemetry";

// EXACT official offsets for Car Dash 331-byte format
const CAR_DASH_OFFSETS = {
  // Race state
  isRaceOn: 0, // int32: 1=racing, 0=not racing

  // Engine telemetry
  currentEngineRpm: 16, // float32: current engine RPM

  // Position data
  positionX: 232, // float32: X position in world
  positionY: 236, // float32: Y position in world
  positionZ: 240, // float32: Z position in world

  // Velocity components (for fallback calculation)
  velocityX: 32, // float32: X velocity (m/s)
  velocityY: 36, // float32: Y velocity (m/s)
  velocityZ: 40, // float32: Z velocity (m/s)

  // Direct performance fields (PRIMARY)
  speed: 244, // float32: direct speed (m/s) - PRIMARY
  power: 248, // float32: engine power (kW) - PRIMARY
  torque: 252, // float32: engine torque (Nm) - PRIMARY

  // Tire temperatures
  tireTempFrontLeft: 256, // float32: front left tire temp (°C)
  tireTempFrontRight: 260, // float32: front right tire temp (°C)
  tireTempRearLeft: 264, // float32: rear left tire temp (°C)
  tireTempRearRight: 268, // float32: rear right tire temp (°C)

  // Additional metrics
  boost: 272, // float32: turbo boost (bar)
  fuel: 276, // float32: fuel level (0-100%)
  distanceTraveled: 280, // float32: distance traveled (meters)

  // Lap timing data
  bestLap: 284, // float32: best lap time (seconds)
  lastLap: 288, // float32: last lap time (seconds)
  currentLap: 292, // float32: current lap time (seconds)
  currentRaceTime: 296, // float32: current race time (seconds)

  // Race data
  lapNumber: 300, // uint16: current lap number
  racePosition: 302, // uint8: current race position

  // Control inputs (uint8)
  accel: 303, // uint8: throttle position (0-255) → normalize to 0-1
  brake: 304, // uint8: brake position (0-255) → normalize to 0-1
  clutch: 305, // uint8: clutch position (0-255) → normalize to 0-1
  handbrake: 306, // uint8: handbrake position (0-255) → normalize to 0-1

  // Gear and steering
  gear: 307, // int8: current gear (-1=reverse, 0=neutral, 1-10=forward)
  steer: 308, // int8: steering input (-127 to 127) → normalize to -1 to 1

  // AI assistance
  normalizedDrivingLine: 309, // int8: normalized driving line (-127 to 127) → normalize to -1 to 1
  normalizedAIBrakeDifference: 310, // int8: normalized AI brake difference (-127 to 127) → normalize to -1 to 1
};

// Constants
const CAR_DASH_SIZE = 331; // EXACT packet size
const SPEED_SMOOTHING_WINDOW = 5; // moving average window
const MAX_SPEED_JUMP = 100; // max speed change per frame (km/h)

export class CarDash331Parser {
  private speedHistory: number[] = [];
  private lastValidTelemetry: TelemetryData | null = null;
  private debugMode = false;
  private lastLogTime = 0;
  private readonly LOG_INTERVAL = 500; // 500ms rate limit

  /**
   * Parse Car Dash 331-byte format with strict validation
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

      // Parse RPM (float32)
      const rpm = buffer.readFloatLE(CAR_DASH_OFFSETS.currentEngineRpm);
      if (isNaN(rpm) || rpm < 0 || rpm > 15000) {
        return null;
      }

      // Parse Speed with field priority (direct field → velocity fallback)
      const { speed: finalSpeed, debugInfo } =
        this.parseSpeedWithPriority(buffer);

      // Parse control inputs (uint8 normalization)
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

      // Parse steering (int8 normalization)
      const steer = Math.max(
        -1,
        Math.min(1, buffer.readInt8(CAR_DASH_OFFSETS.steer) / 127),
      );

      // Parse gear (int8 validation)
      const gear = buffer.readInt8(CAR_DASH_OFFSETS.gear);
      if (gear < -1 || gear > 10) {
        return null;
      }

      // Parse position data
      const positionX = buffer.readFloatLE(CAR_DASH_OFFSETS.positionX);
      const positionY = buffer.readFloatLE(CAR_DASH_OFFSETS.positionY);
      const positionZ = buffer.readFloatLE(CAR_DASH_OFFSETS.positionZ);

      // Parse velocity components
      const velocityX = buffer.readFloatLE(CAR_DASH_OFFSETS.velocityX);
      const velocityY = buffer.readFloatLE(CAR_DASH_OFFSETS.velocityY);
      const velocityZ = buffer.readFloatLE(CAR_DASH_OFFSETS.velocityZ);

      // Parse performance metrics
      const power = this.parseFloatField(
        buffer,
        CAR_DASH_OFFSETS.power,
        0,
        2000,
      );
      const torque = this.parseFloatField(
        buffer,
        CAR_DASH_OFFSETS.torque,
        0,
        3000,
      );
      const boost = this.parseFloatField(buffer, CAR_DASH_OFFSETS.boost, 0, 5);
      const fuel = this.parseFloatField(buffer, CAR_DASH_OFFSETS.fuel, 0, 100);
      const distanceTraveled = this.parseFloatField(
        buffer,
        CAR_DASH_OFFSETS.distanceTraveled,
        0,
        100000,
      );

      // Parse lap timing data
      const bestLap = this.parseFloatField(
        buffer,
        CAR_DASH_OFFSETS.bestLap,
        0,
        3600,
      );
      const lastLap = this.parseFloatField(
        buffer,
        CAR_DASH_OFFSETS.lastLap,
        0,
        3600,
      );
      const currentLap = this.parseFloatField(
        buffer,
        CAR_DASH_OFFSETS.currentLap,
        0,
        3600,
      );
      const currentRaceTime = this.parseFloatField(
        buffer,
        CAR_DASH_OFFSETS.currentRaceTime,
        0,
        86400,
      );

      // Parse race data
      const lapNumber = buffer.readUInt16LE(CAR_DASH_OFFSETS.lapNumber);
      const racePosition = buffer.readUInt8(CAR_DASH_OFFSETS.racePosition);

      // Parse tire temperatures
      const tireTempFrontLeft = this.parseFloatField(
        buffer,
        CAR_DASH_OFFSETS.tireTempFrontLeft,
        0,
        200,
      );
      const tireTempFrontRight = this.parseFloatField(
        buffer,
        CAR_DASH_OFFSETS.tireTempFrontRight,
        0,
        200,
      );
      const tireTempRearLeft = this.parseFloatField(
        buffer,
        CAR_DASH_OFFSETS.tireTempRearLeft,
        0,
        200,
      );
      const tireTempRearRight = this.parseFloatField(
        buffer,
        CAR_DASH_OFFSETS.tireTempRearRight,
        0,
        200,
      );

      // Parse AI assistance data
      const normalizedDrivingLine = Math.max(
        -1,
        Math.min(
          1,
          buffer.readInt8(CAR_DASH_OFFSETS.normalizedDrivingLine) / 127,
        ),
      );
      const normalizedAIBrakeDifference = Math.max(
        -1,
        Math.min(
          1,
          buffer.readInt8(CAR_DASH_OFFSETS.normalizedAIBrakeDifference) / 127,
        ),
      );

      // Create telemetry data object
      const telemetry: TelemetryData = {
        speed: finalSpeed,
        rpm: rpm,
        gear: gear,
        throttle: throttle,
        brake: brake,
        clutch: clutch,
        handbrake: handbrake,
        steer: steer,
        positionX: positionX,
        positionY: positionY,
        positionZ: positionZ,
        velocityX: velocityX,
        velocityY: velocityY,
        velocityZ: velocityZ,
        power: power,
        torque: torque,
        boost: boost,
        fuel: fuel,
        distanceTraveled: distanceTraveled,
        bestLap: bestLap,
        lastLap: lastLap,
        currentLap: currentLap,
        currentRaceTime: currentRaceTime,
        lapNumber: lapNumber,
        racePosition: racePosition,
        tireTempFrontLeft: tireTempFrontLeft,
        tireTempFrontRight: tireTempFrontRight,
        tireTempRearLeft: tireTempRearLeft,
        tireTempRearRight: tireTempRearRight,
        normalizedDrivingLine: normalizedDrivingLine,
        normalizedAIBrakeDifference: normalizedAIBrakeDifference,
        isRaceOn: isRaceOn,
      };

      // Speed consistency validation (prevent unrealistic jumps)
      if (this.lastValidTelemetry) {
        const speedDelta = Math.abs(
          telemetry.speed - this.lastValidTelemetry.speed,
        );
        if (speedDelta > MAX_SPEED_JUMP) {
          return null;
        }
      }

      this.lastValidTelemetry = telemetry;

      // Mandatory logging every 500ms
      this.logTelemetry(telemetry, debugInfo);

      return {
        raw: buffer,
        parsed: telemetry,
        timestamp: Date.now(),
        debugInfo: debugInfo,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse speed with field priority (direct field → velocity fallback)
   */
  private parseSpeedWithPriority(buffer: Buffer): {
    speed: number;
    debugInfo: any;
  } {
    let finalSpeed = 0;
    let debugInfo: any = {};

    try {
      // PRIMARY: Try direct speed field (offset 244)
      const rawSpeed = buffer.readFloatLE(CAR_DASH_OFFSETS.speed);
      debugInfo.rawSpeed = rawSpeed;

      if (!isNaN(rawSpeed) && rawSpeed >= 0 && rawSpeed <= 150) {
        // Direct speed is valid, use it
        finalSpeed = rawSpeed * 3.6; // Convert m/s to km/h
        debugInfo.source = "direct";
        debugInfo.computedSpeed = null;
      } else {
        // FALLBACK: Calculate from velocity components (offsets 32, 36, 40)
        const vx = buffer.readFloatLE(CAR_DASH_OFFSETS.velocityX);
        const vy = buffer.readFloatLE(CAR_DASH_OFFSETS.velocityY);
        const vz = buffer.readFloatLE(CAR_DASH_OFFSETS.velocityZ);

        if (isNaN(vx) || isNaN(vy) || isNaN(vz)) {
          debugInfo.source = "error";
          finalSpeed = 0;
        } else {
          const computedSpeedMps = Math.sqrt(vx * vx + vy * vy + vz * vz);
          finalSpeed = computedSpeedMps * 3.6;
          debugInfo.source = "velocity_fallback";
          debugInfo.computedSpeed = computedSpeedMps;
          debugInfo.vx = vx;
          debugInfo.vy = vy;
          debugInfo.vz = vz;
        }
      }

      // Clamp to valid range
      finalSpeed = Math.max(0, Math.min(500, finalSpeed));

      // Apply smoothing
      return {
        speed: this.applySpeedSmoothing(finalSpeed),
        debugInfo: debugInfo,
      };
    } catch (error) {
      return {
        speed: 0,
        debugInfo: { source: "error", error: error },
      };
    }
  }

  /**
   * Parse float field with validation
   */
  private parseFloatField(
    buffer: Buffer,
    offset: number,
    min: number,
    max: number,
  ): number {
    try {
      if (offset >= buffer.length) return 0;
      const value = buffer.readFloatLE(offset);
      if (isNaN(value) || value < min || value > max) return 0;
      return value;
    } catch {
      return 0;
    }
  }

  /**
   * Apply moving average smoothing to speed values
   */
  private applySpeedSmoothing(currentSpeed: number): number {
    this.speedHistory.push(currentSpeed);

    // Maintain window size
    if (this.speedHistory.length > SPEED_SMOOTHING_WINDOW) {
      this.speedHistory.shift();
    }

    // Calculate moving average
    const sum = this.speedHistory.reduce((acc, speed) => acc + speed, 0);
    return sum / this.speedHistory.length;
  }

  /**
   * Mandatory logging every 500ms
   */
  private logTelemetry(data: TelemetryData, debugInfo?: any): void {
    const now = Date.now();
    if (now - this.lastLogTime < this.LOG_INTERVAL) {
      return;
    }

    // Telemetry Snapshot format
    const snapshot = `Telemetry Snapshot: Speed: ${Math.round(data.speed)} km/h, RPM: ${Math.round(data.rpm)}, Gear: ${data.gear}, Throttle: ${Math.round(data.throttle * 100)} %, Brake: ${Math.round(data.brake * 100)} %, Torque: ${Math.round(data.torque)} Nm, Power: ${Math.round(data.power)} kW, Boost: ${data.boost.toFixed(1)} bar, Fuel: ${Math.round(data.fuel)} %, Lap: ${data.lapNumber}`;

    console.log(snapshot);

    // Debug logging
    if (this.debugMode && debugInfo) {
      console.log("🔍 DEBUG TELEMETRY DATA:");
      console.log(
        `  Raw Speed: ${debugInfo.rawSpeed?.toFixed(2) ?? "N/A"} m/s`,
      );
      console.log(`  Speed Source: ${debugInfo.speedSource}`);

      if (debugInfo.velocityComponents) {
        const { vx, vy, vz } = debugInfo.velocityComponents;
        console.log(
          `  Velocity Components: vx=${vx.toFixed(2)}, vy=${vy.toFixed(2)}, vz=${vz.toFixed(2)} m/s`,
        );
      }

      if (debugInfo.computedSpeed !== undefined) {
        console.log(
          `  Computed Speed: ${debugInfo.computedSpeed.toFixed(2)} m/s`,
        );
      }

      console.log("");
    }

    this.lastLogTime = now;
  }

  /**
   * Enable/disable debug mode
   */
  public setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
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
