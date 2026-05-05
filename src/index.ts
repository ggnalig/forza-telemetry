// Main entry point for FULL Car Dash 331-byte telemetry system
// Wires together UDP listener, parser, processor, and WebSocket server

import { UdpListener } from "./udp/listener";
import { carDash331Parser } from "./udp/parser";
import { TelemetryProcessor } from "./telemetry/processor";
import { WebSocketServer } from "./websocket/server";
import { TelemetryLogger } from "./utils/logger";

class CarDashTelemetrySystem {
  private udpListener: UdpListener;
  private telemetryProcessor: TelemetryProcessor;
  private webSocketServer: WebSocketServer;
  private telemetryLogger: TelemetryLogger;
  private isRunning: boolean = false;
  private debugMode: boolean = false;

  constructor() {
    this.udpListener = new UdpListener(5300);
    this.telemetryProcessor = new TelemetryProcessor();
    this.webSocketServer = new WebSocketServer(3000);
    this.telemetryLogger = new TelemetryLogger();

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
        this.telemetryLogger.logWarning(`Invalid packet size: ${size} bytes (expected 331)`);
      }
    });

    // Handle UDP errors
    this.udpListener.on("error", (error: Error) => {
      this.telemetryLogger.logError("UDP Listener error", error.message);
      if (error.message.includes("Port 5300 is already in use")) {
        console.error("❌ Port 5300 is already in use. Please ensure no other application is using this port.");
        process.exit(1);
      }
    });

    // Handle WebSocket server errors
    this.webSocketServer.getServer().on("error", (error: Error) => {
      this.telemetryLogger.logError("WebSocket server error", error.message);
    });

    // Handle client connections
    this.webSocketServer.getServer().on("connection", (socket: any) => {
      if (this.debugMode) {
        console.log(`🔌 WebSocket client connected: ${socket.id}`);
      }
    });
  }

  private handleIncomingTelemetry(buffer: Buffer): void {
    try {
      // Parse the FULL 331-byte Car Dash format
      const parsedData = carDash331Parser.parse(buffer);

      if (!parsedData) {
        return; // Invalid data, skip processing
      }

      // Log telemetry snapshot (mandatory every 500ms)
      this.telemetryLogger.logTelemetry(parsedData.parsed);

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
      console.log("🚀 Starting FULL Car Dash 331-byte telemetry system...");
      console.log("=".repeat(80));
      console.log("🎯 FULL 331-BYTE CAR DASH FORMAT ACTIVE - ALL FIELDS IMPLEMENTED");
      console.log("=".repeat(80));

      // Start UDP listener
      await this.udpListener.start();

      // WebSocket server is already started in constructor

      this.isRunning = true;

      console.log("✅ Telemetry system started successfully");
      console.log("📡 UDP listener on port 5300");
      console.log("🌐 WebSocket server on port 3000");
      console.log("⏳ Waiting for Car Dash 331-byte telemetry data...");
      console.log("");
      console.log("🔧 System Features:");
      console.log("• EXACT 331-byte packet validation");
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

      // Stop UDP listener
      await this.udpListener.stop();

      // Stop WebSocket server
      await this.webSocketServer.stop();

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
    carDash331Parser.setDebugMode(enabled);
    console.log(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
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