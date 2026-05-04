// UDP Listener for Forza Motorsport Car Dash 331-byte format
// Strict packet size validation and event-driven architecture

import dgram from "dgram";
import { EventEmitter } from "events";

export class UdpListener extends EventEmitter {
  private server: dgram.Socket;
  private port: number;
  private isRunning: boolean = false;

  constructor(port: number = 5300) {
    super();
    this.port = port;
    this.server = dgram.createSocket("udp4");
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle incoming UDP packets
    this.server.on("message", (msg: Buffer) => {
      // STRICT: Only accept 331-byte packets
      if (msg.length !== 331) {
        this.emit("invalid_packet", msg.length);
        return;
      }

      // Forward valid buffer to parser
      this.emit("data", msg);
    });

    // Handle UDP errors
    this.server.on("error", (error: Error) => {
      if (error.message.includes("EADDRINUSE")) {
        this.emit("error", new Error(`Port ${this.port} is already in use`));
      } else {
        this.emit("error", error);
      }
    });

    // Handle server start
    this.server.on("listening", () => {
      const address = this.server.address();
      console.log(
        `📡 UDP Listener started on ${address.address}:${address.port}`,
      );
      console.log(`🎯 STRICT 331-byte Car Dash format active`);
      this.isRunning = true;
      this.emit("listening", address);
    });

    // Handle server close
    this.server.on("close", () => {
      this.isRunning = false;
      this.emit("closed");
    });
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("listening", resolve);
      this.server.once("error", reject);
      this.server.bind(this.port, "0.0.0.0");
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isRunning) {
        resolve();
        return;
      }

      this.server.once("close", resolve);
      this.server.close();
    });
  }

  public getStatus(): boolean {
    return this.isRunning;
  }

  public getPort(): number {
    return this.port;
  }
}
