// Minimal REST API for browsing/deleting recorded sessions - mirrors
// tune-api-server.ts's hand-rolled pattern (a handful of routes doesn't need
// a routing framework).

import * as http from "http";
import { SessionRecorder } from "../services/session-recorder";

export class SessionApiServer {
  private server: http.Server;

  constructor(
    private readonly recorder: SessionRecorder,
    private readonly port: number = 3003,
  ) {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  public start(): void {
    this.server.listen(this.port, () => {
      console.log(`📼 Session API listening on port ${this.port}`);
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    // Personal-tool CORS: the UI dev server runs on a different port
    // (Vite), so the browser treats this as cross-origin.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);
    const segments = url.pathname.split("/").filter(Boolean);

    this.route(req.method ?? "GET", segments, url.searchParams, res);
  }

  private route(
    method: string,
    segments: string[],
    query: URLSearchParams,
    res: http.ServerResponse,
  ): void {
    if (segments[0] !== "sessions") {
      this.sendJson(res, 404, { error: "Not found" });
      return;
    }

    // GET /sessions/:id/frames?lap=N
    if (segments[1] && segments[2] === "frames" && method === "GET") {
      const session = this.recorder.getSession(segments[1]);
      if (!session) {
        this.sendJson(res, 404, { error: "Session not found" });
        return;
      }
      const lapParam = query.get("lap");
      const frames = this.recorder.getFrames(
        segments[1],
        lapParam !== null ? Number(lapParam) : undefined,
      );
      this.sendJson(res, 200, { frames });
      return;
    }

    // GET/DELETE /sessions/:id
    if (segments[1] && !segments[2]) {
      if (method === "GET") {
        const session = this.recorder.getSession(segments[1]);
        if (!session) {
          this.sendJson(res, 404, { error: "Session not found" });
          return;
        }
        this.sendJson(res, 200, { session });
        return;
      }
      if (method === "DELETE") {
        const deleted = this.recorder.deleteSession(segments[1]);
        this.sendJson(res, deleted ? 200 : 404, { success: deleted });
        return;
      }
    }

    // GET /sessions?buildKey=X
    if (!segments[1] && method === "GET") {
      const buildKey = query.get("buildKey") ?? undefined;
      this.sendJson(res, 200, { sessions: this.recorder.listSessions(buildKey) });
      return;
    }

    this.sendJson(res, 404, { error: "Not found" });
  }

  private sendJson(
    res: http.ServerResponse,
    status: number,
    payload: unknown,
  ): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  }
}
