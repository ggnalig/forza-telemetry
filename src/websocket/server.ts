import { WebSocketServer as WSWebSocketServer } from "ws";
import { ProcessedTelemetryData } from "../types/telemetry";

export class TelemetryWebSocketServer {
  private wss: WSWebSocketServer;
  private clients: Set<any> = new Set();
  private port: number;
  private telemetryBuffer: ProcessedTelemetryData | null = null;
  private broadcastCount: number = 0;

  constructor(port: number = 3001) {
    this.port = port;
    this.wss = new WSWebSocketServer({ port: this.port });

    console.log(`✅ WebSocket listening on port ${this.port}`);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.wss.on("connection", (ws) => {
      this.clients.add(ws);

      ws.on("close", () => {
        this.clients.delete(ws);
      });

      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        this.clients.delete(ws);
      });

      if (this.telemetryBuffer) {
        ws.send(
          JSON.stringify(this.createOptimizedPayload(this.telemetryBuffer)),
        );
      }
    });
  }

  private createOptimizedPayload(data: ProcessedTelemetryData): any {
    return {
      parsed: data.parsed,
      timestamp: data.timestamp,
      carInfo: data.carInfo,
      activeTune: data.activeTune,
      diagnostics: data.diagnostics,
      broadcastId: this.broadcastCount++,
    };
  }

  public broadcastTelemetry(data: ProcessedTelemetryData): void {
    this.telemetryBuffer = data;

    if (this.clients.size === 0) return;

    const payload = JSON.stringify(this.createOptimizedPayload(data));

    this.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(payload);
      }
    });
  }

  public getConnectedClientsCount(): number {
    return this.clients.size;
  }

  public getStats(): { clients: number; broadcasts: number } {
    return {
      clients: this.clients.size,
      broadcasts: this.broadcastCount,
    };
  }

  public getServer(): WSWebSocketServer {
    return this.wss;
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close(() => {
        resolve();
      });
    });
  }
}

export default TelemetryWebSocketServer;
