// WebSocket Server for Car Dash 331-byte telemetry streaming
// Real-time client communication with Socket.IO

import { Server, Socket } from "socket.io";
import { createServer } from "http";
import { ProcessedTelemetryData } from "../types/telemetry";

export class WebSocketServer {
  private io: Server;
  private connectedClients: number = 0;
  private currentTelemetry: ProcessedTelemetryData | null = null;
  private broadcastInterval: NodeJS.Timeout | null = null;

  constructor(port: number = 3000) {
    const httpServer = createServer();
    this.io = new Server(httpServer, {
      cors: { origin: "*" }, // Allow all origins for development
    });

    this.setupEventHandlers();
    this.startServer(port);
  }

  private setupEventHandlers(): void {
    this.io.on("connection", (socket: Socket) => {
      this.connectedClients++;
      console.log(`🔌 WebSocket client connected: ${socket.id} (Total: ${this.connectedClients})`);

      // Send current telemetry to new client
      if (this.currentTelemetry) {
        socket.emit("telemetry", this.currentTelemetry);
      }

      // Handle debug mode requests
      socket.on("debug", (enabled: boolean) => {
        console.log(`Debug mode ${enabled ? 'enabled' : 'disabled'} for client ${socket.id}`);
      });

      // Handle client disconnection
      socket.on("disconnect", () => {
        this.connectedClients--;
        console.log(`🔌 WebSocket client disconnected: ${socket.id} (Total: ${this.connectedClients})`);
      });

      // Handle specific telemetry requests
      socket.on("get_telemetry", () => {
        if (this.currentTelemetry) {
          socket.emit("telemetry", this.currentTelemetry);
        }
      });

      // Handle subscription to specific data streams
      socket.on("subscribe", (dataTypes: string[]) => {
        console.log(`Client ${socket.id} subscribed to:`, dataTypes);
        // Future enhancement: filter data based on subscription
      });
    });

    // Handle server-level events
    this.io.on("error", (error: Error) => {
      console.error("❌ WebSocket server error:", error);
    });
  }

  private startServer(port: number): void {
    this.io.listen(port);
    console.log(`🌐 WebSocket server started on port ${port}`);
  }

  /**
   * Broadcast telemetry data to all connected clients
   */
  public broadcastTelemetry(data: ProcessedTelemetryData): void {
    this.currentTelemetry = data;
    this.io.emit("telemetry", data);
    
    // Log broadcast statistics if in debug mode
    if (this.connectedClients > 0) {
      const telemetry = data.parsed;
      console.log(`📡 Broadcasted telemetry to ${this.connectedClients} clients: ${Math.round(telemetry.performance.speedKmh)}km/h | ${Math.round(telemetry.engine.rpm)}RPM | G${telemetry.input.gear}`);
    }
  }

  /**
   * Get current telemetry data
   */
  public getCurrentTelemetry(): ProcessedTelemetryData | null {
    return this.currentTelemetry;
  }

  /**
   * Get connected clients count
   */
  public getConnectedClientsCount(): number {
    return this.connectedClients;
  }

  /**
   * Get Socket.IO server instance
   */
  public getServer(): Server {
    return this.io;
  }

  /**
   * Set up periodic broadcasting (for future enhancement)
   */
  public startPeriodicBroadcast(intervalMs: number = 100): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
    }

    this.broadcastInterval = setInterval(() => {
      if (this.currentTelemetry) {
        this.broadcastTelemetry(this.currentTelemetry);
      }
    }, intervalMs);
  }

  /**
   * Stop periodic broadcasting
   */
  public stopPeriodicBroadcast(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
  }

  /**
   * Stop the WebSocket server
   */
  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.stopPeriodicBroadcast();
      this.io.close(() => {
        console.log("🛑 WebSocket server stopped");
        resolve();
      });
    });
  }

  /**
   * Get server statistics
   */
  public getStats(): {
    connectedClients: number;
    hasCurrentTelemetry: boolean;
    isPeriodicBroadcasting: boolean;
  } {
    return {
      connectedClients: this.connectedClients,
      hasCurrentTelemetry: this.currentTelemetry !== null,
      isPeriodicBroadcasting: this.broadcastInterval !== null,
    };
  }
}