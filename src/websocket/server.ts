import { WebSocketServer as WSWebSocketServer } from "ws";
import { ProcessedTelemetryData } from "../types/telemetry";

// Single source of truth for whether the "smart" gauge features (dynamic
// redline, shift recommendation, shift lights) are exposed at all - the UI
// reads this straight off the payload instead of needing its own copy of
// the flag, so there's only one place to toggle. Defaults to hidden: the
// model's recommendations are still a work in progress, so this stays off
// until explicitly enabled.
const SHOW_RECOMMENDATION = process.env.SHOW_RECOMMENDATION === "true";

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
      efficiency: data.efficiency,
      showRecommendation: SHOW_RECOMMENDATION,
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
