// Telemetry Processor for Car Dash 331-byte format
// Data transformation and validation layer

import { TelemetryData, ParsedTelemetryData, ProcessedTelemetryData } from "../types/telemetry";

export class TelemetryProcessor {
  private lastProcessedTelemetry: TelemetryData | null = null;

  /**
   * Process and transform telemetry data
   * Validates data consistency and applies transformations
   */
  public process(rawData: ParsedTelemetryData): ProcessedTelemetryData {
    const telemetry = rawData.parsed;

    // Validate data consistency
    const validatedData = this.validateTelemetryConsistency(telemetry);

    // Apply transformations
    const transformedData = this.transformTelemetryData(validatedData);

    // Store for next validation
    this.lastProcessedTelemetry = transformedData;

    return {
      raw: rawData.raw,
      parsed: transformedData,
      timestamp: Date.now(),
    };
  }

  /**
   * Validate telemetry data consistency
   */
  private validateTelemetryConsistency(data: TelemetryData): TelemetryData {
    // Check for logical inconsistencies
    let validatedData = { ...data };

    // Validate speed vs RPM relationship
    if (data.speed > 0 && data.rpm < 800) {
      // Engine should be running if car is moving
      validatedData.rpm = Math.max(800, data.rpm);
    }

    // Validate gear vs speed relationship
    if (data.gear === 0 && data.speed > 5) {
      // Car shouldn't be moving fast in neutral
      validatedData.speed = Math.min(5, data.speed);
    }

    // Validate throttle vs brake relationship
    if (data.throttle > 0.8 && data.brake > 0.8) {
      // Both pedals shouldn't be pressed hard simultaneously
      validatedData.brake = Math.min(0.5, data.brake);
    }

    // Validate tire temperature consistency
    const avgTireTemp = (data.tireTempFrontLeft + data.tireTempFrontRight + 
                        data.tireTempRearLeft + data.tireTempRearRight) / 4;
    
    if (avgTireTemp > 150) {
      // Unrealistic tire temperatures
      validatedData.tireTempFrontLeft = Math.min(150, data.tireTempFrontLeft);
      validatedData.tireTempFrontRight = Math.min(150, data.tireTempFrontRight);
      validatedData.tireTempRearLeft = Math.min(150, data.tireTempRearLeft);
      validatedData.tireTempRearRight = Math.min(150, data.tireTempRearRight);
    }

    return validatedData;
  }

  /**
   * Transform telemetry data for consistency
   */
  private transformTelemetryData(data: TelemetryData): TelemetryData {
    // Apply additional transformations
    let transformedData = { ...data };

    // Smooth lap times if they show unrealistic jumps
    if (this.lastProcessedTelemetry) {
      const lastBestLap = this.lastProcessedTelemetry.bestLap;
      const lastLastLap = this.lastProcessedTelemetry.lastLap;
      
      // Validate lap time consistency
      if (data.bestLap > 0 && data.bestLap < lastBestLap - 10) {
        // Best lap shouldn't improve by more than 10 seconds suddenly
        transformedData.bestLap = Math.max(data.bestLap, lastBestLap - 1);
      }
      
      if (data.lastLap > 0 && Math.abs(data.lastLap - lastLastLap) > 60) {
        // Last lap shouldn't change by more than 60 seconds
        transformedData.lastLap = lastLastLap;
      }
    }

    // Ensure race position is reasonable
    if (data.racePosition < 1) {
      transformedData.racePosition = 1;
    } else if (data.racePosition > 24) {
      // Forza typically supports up to 24 cars
      transformedData.racePosition = 24;
    }

    // Normalize AI assistance values
    if (Math.abs(data.normalizedDrivingLine) > 1) {
      transformedData.normalizedDrivingLine = Math.sign(data.normalizedDrivingLine);
    }
    
    if (Math.abs(data.normalizedAIBrakeDifference) > 1) {
      transformedData.normalizedAIBrakeDifference = Math.sign(data.normalizedAIBrakeDifference);
    }

    return transformedData;
  }

  /**
   * Get processing statistics
   */
  public getStats(): {
    lastProcessedTime: number | null;
    isActive: boolean;
  } {
    return {
      lastProcessedTime: this.lastProcessedTelemetry ? Date.now() : null,
      isActive: this.lastProcessedTelemetry !== null,
    };
  }

  /**
   * Reset processor state
   */
  public reset(): void {
    this.lastProcessedTelemetry = null;
  }
}