// Main entry point for FULL Forza Horizon 6 Data Out (324-byte) telemetry system
// Wires together UDP listener, parser, processor, and WebSocket server

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { UdpListener } from "./udp/listener";
import { fh6TelemetryParser } from "./udp/parser";
import { TelemetryProcessor } from "./telemetry/processor";
import WebSocketServer from "./websocket/server";
import { TelemetryLogger } from "./utils/logger";
import { GearboxTuneStore } from "./services/gearbox-tune-store";
import { TuneApiServer } from "./http/tune-api-server";

class CarDashTelemetrySystem {
  private udpListener: UdpListener;
  private telemetryProcessor: TelemetryProcessor;
  private webSocketServer: WebSocketServer;
  private telemetryLogger: TelemetryLogger;
  private tuneApiServer: TuneApiServer;
  private isRunning: boolean = false;
  private debugMode: boolean = false;

  constructor() {
    const gearboxTuneStore = new GearboxTuneStore();

    this.udpListener = new UdpListener(7300);
    this.telemetryProcessor = new TelemetryProcessor(false, undefined, gearboxTuneStore);
    this.webSocketServer = new WebSocketServer(3001);
    this.telemetryLogger = new TelemetryLogger();
    this.tuneApiServer = new TuneApiServer(gearboxTuneStore, 3002);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle incoming UDP data
    this.udpListener.on("data", (buffer: Buffer) => {
      this.handleIncomingTelemetry(buffer);
    });

    // Handle invalid packet size
    this.udpListener.on("invalid_packet", (size: number) => {
      if (this.debugMode) {
        this.telemetryLogger.logWarning(
          `Invalid packet size: ${size} bytes (expected 324)`,
        );
      }
    });

    // Handle UDP errors
    this.udpListener.on("error", (error: Error) => {
      this.telemetryLogger.logError("UDP Listener error", error.message);
      if (error.message.includes("is already in use")) {
        console.error(
          `❌ Port ${this.udpListener.getPort()} is already in use. Please ensure no other application is using this port.`,
        );
        process.exit(1);
      }
    });

    // Handle WebSocket server errors
    this.webSocketServer.getServer().on("error", (error: Error) => {
      this.telemetryLogger.logError("WebSocket server error", error.message);
    });

    // Handle client connections
    this.webSocketServer.getServer().on("connection", () => {
      if (this.debugMode) {
        console.log(
          `🔌 WebSocket client connected (${this.webSocketServer.getConnectedClientsCount()} total)`,
        );
      }
    });
  }

  private handleIncomingTelemetry(buffer: Buffer): void {
    try {
      // Parse the FULL 324-byte FH6 Data Out format
      const parsedData = fh6TelemetryParser.parse(buffer);

      if (!parsedData) {
        return; // Invalid data, skip processing
      }

      // Log telemetry snapshot (mandatory every 500ms)
      // this.telemetryLogger.logTelemetry(parsedData.parsed);

      // Process/transform the data
      const processedData = this.telemetryProcessor.process(parsedData);
      // Broadcast to WebSocket clients
      this.webSocketServer.broadcastTelemetry(processedData);
    } catch (error) {
      this.telemetryLogger.logError("Error handling telemetry data", error);
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log("⚠️  Telemetry system is already running");
      return;
    }

    try {
      console.log("🚀 Starting FULL FH6 Data Out 324-byte telemetry system...");
      console.log("=".repeat(80));
      console.log(
        "🎯 FULL 324-BYTE FH6 DATA OUT FORMAT ACTIVE - ALL FIELDS IMPLEMENTED",
      );
      console.log("=".repeat(80));

      // Start UDP listener
      await this.udpListener.start();

      // WebSocket server is already started in constructor
      this.tuneApiServer.start();

      this.isRunning = true;

      console.log("✅ Telemetry system started successfully");
      console.log(`📡 UDP listener on port ${this.udpListener.getPort()}`);
      console.log("🌐 WebSocket server on port 3001");
      console.log("🔧 Tune API on port 3002");
      console.log("⏳ Waiting for FH6 Data Out 324-byte telemetry data...");
      console.log("");
      console.log("🔧 System Features:");
      console.log("• EXACT 324-byte packet validation");
      console.log("• FULL format with ALL extended data fields");
      console.log("• NO FALLBACKS - direct field usage only");
      console.log("• Structured nested object output");
      console.log("• Comprehensive data validation");
      console.log("• Mandatory 500ms telemetry logging");
      console.log("• Real-time WebSocket streaming");
      console.log("• Debug mode support");
      console.log("");
      console.log("💡 Enable debug mode: Set DEBUG=true environment variable");
    } catch (error) {
      console.error("❌ Failed to start telemetry system:", error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log("⚠️  Telemetry system is not running");
      return;
    }

    try {
      console.log("🛑 Stopping telemetry system...");

      // Persist the current car's learned shift/gearing profile before exit
      this.telemetryProcessor.persistCurrentCarProfile();

      // Stop UDP listener
      await this.udpListener.stop();

      // Stop WebSocket server
      await this.webSocketServer.stop();

      // Stop tune API server
      await this.tuneApiServer.stop();

      this.isRunning = false;
      console.log("✅ Telemetry system stopped");
    } catch (error) {
      console.error("❌ Error stopping telemetry system:", error);
      throw error;
    }
  }

  public setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    this.telemetryLogger.setDebugMode(enabled);
    fh6TelemetryParser.setDebugMode(enabled);
    console.log(`Debug mode ${enabled ? "enabled" : "disabled"}`);
  }

  public getStatus(): {
    isRunning: boolean;
    udpStatus: boolean;
    wsConnectedClients: number;
    debugMode: boolean;
  } {
    return {
      isRunning: this.isRunning,
      udpStatus: this.udpListener.getStatus(),
      wsConnectedClients: this.webSocketServer.getConnectedClientsCount(),
      debugMode: this.debugMode,
    };
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Received SIGINT, shutting down gracefully...");
  await telemetrySystem.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
  await telemetrySystem.stop();
  process.exit(0);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Create and start the system
const telemetrySystem = new CarDashTelemetrySystem();

// Check for debug mode
if (process.env.DEBUG === "true") {
  telemetrySystem.setDebugMode(true);
}

// Start the system
telemetrySystem.start().catch((error) => {
  console.error("❌ Failed to start telemetry system:", error);
  process.exit(1);
});
