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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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
    // GET /recording - current on/off state + the in-progress session id (if
    // any), so the UI's Record button can reflect reality on load/reconnect
    // instead of assuming it starts off.
    if (segments[0] === "recording" && !segments[1] && method === "GET") {
      this.sendJson(res, 200, this.recorder.getStatus());
      return;
    }

    // POST /recording/start | /recording/stop - the "Record" button itself.
    // Manual on purpose: neither isRaceOn nor lap.number reliably tells a
    // timed event apart from free-roam driving (confirmed in-game), so
    // there's no telemetry-only way left to infer "record this" - see
    // session-recorder.ts's file doc comment.
    if (segments[0] === "recording" && segments[1] === "start" && method === "POST") {
      this.recorder.setRecordingEnabled(true);
      this.sendJson(res, 200, this.recorder.getStatus());
      return;
    }
    if (segments[0] === "recording" && segments[1] === "stop" && method === "POST") {
      this.recorder.setRecordingEnabled(false);
      this.sendJson(res, 200, this.recorder.getStatus());
      return;
    }

    // GET /analysis?buildKey=X - aggregate RPM analysis across every
    // recorded session for a build (see SessionRecorder.analyzeByBuildKey).
    // Not nested under /sessions since it's a cross-session aggregate, not
    // a single session resource.
    if (segments[0] === "analysis" && method === "GET") {
      const buildKey = query.get("buildKey");
      if (!buildKey) {
        this.sendJson(res, 400, { error: "buildKey query param is required" });
        return;
      }
      const report = this.recorder.analyzeByBuildKey(buildKey);
      if (!report) {
        this.sendJson(res, 404, { error: "No sessions found for this build" });
        return;
      }
      this.sendJson(res, 200, { report });
      return;
    }

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
