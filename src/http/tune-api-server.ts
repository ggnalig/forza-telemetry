// Minimal REST API for managing GearboxTune profiles (create/edit/delete/
// activate) - the one thing this backend needs beyond its existing UDP-in/
// WS-out pipeline, since tunes are entered by a human (reading Forza's own
// tuning menu) rather than derived from telemetry. Hand-rolled on Node's
// built-in `http` module rather than pulling in Express: a handful of routes
// over a tiny JSON API doesn't need a routing framework.

import * as http from "http";
import { GearboxTuneStore } from "../services/gearbox-tune-store";

export class TuneApiServer {
  private server: http.Server;

  constructor(
    private readonly store: GearboxTuneStore,
    private readonly port: number = 3002,
  ) {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  public start(): void {
    this.server.listen(this.port, () => {
      console.log(`🔧 Tune API listening on port ${this.port}`);
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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);
    const segments = url.pathname.split("/").filter(Boolean);

    this.readJsonBody(req)
      .then((body) =>
        this.route(req.method ?? "GET", segments, url.searchParams, body, res),
      )
      .catch((error) => {
        this.sendJson(res, 400, { error: `Invalid request body: ${error}` });
      });
  }

  private readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        if (!data) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
      req.on("error", reject);
    });
  }

  private route(
    method: string,
    segments: string[],
    query: URLSearchParams,
    body: any,
    res: http.ServerResponse,
  ): void {
    if (segments[0] !== "tunes") {
      this.sendJson(res, 404, { error: "Not found" });
      return;
    }

    // GET /tunes/active?carOrdinal=X
    if (segments[1] === "active" && method === "GET") {
      const carOrdinal = Number(query.get("carOrdinal"));
      this.sendJson(res, 200, { tune: this.store.getActiveTune(carOrdinal) });
      return;
    }

    // POST /tunes/deactivate  { carOrdinal }
    if (segments[1] === "deactivate" && method === "POST") {
      const carOrdinal = Number(body?.carOrdinal);
      this.store.setActiveTune(carOrdinal, null);
      this.sendJson(res, 200, { success: true });
      return;
    }

    // POST /tunes/:id/activate
    if (segments[1] && segments[2] === "activate" && method === "POST") {
      const tune = this.store.getTune(segments[1]);
      if (!tune) {
        this.sendJson(res, 404, { error: "Tune not found" });
        return;
      }
      this.store.setActiveTune(tune.carOrdinal, tune.id);
      this.sendJson(res, 200, { tune });
      return;
    }

    // PUT/DELETE /tunes/:id
    if (segments[1] && !segments[2]) {
      if (method === "PUT") {
        // Only include a key if the request body actually sent it, so a PUT
        // that doesn't mention e.g. maxRpmOverride leaves the stored value
        // untouched rather than implicitly clearing it (see
        // GearboxTuneStore.updateTune's `"key" in updates` checks). `null` is
        // the wire sentinel for "clear this override" - JSON.stringify drops
        // `undefined` keys entirely on the client, so `null` is the only way
        // a JSON body can express "explicitly cleared" over HTTP.
        const clearable = <T,>(value: T | null | undefined): T | undefined =>
          value === null ? undefined : value;
        const updates: Parameters<typeof this.store.updateTune>[1] = {
          name: body?.name,
          gearRatios: body?.gearRatios,
        };
        if (body && "maxRpmOverride" in body) updates.maxRpmOverride = clearable(body.maxRpmOverride);
        if (body && "maxRpmPerGearOverride" in body) updates.maxRpmPerGearOverride = clearable(body.maxRpmPerGearOverride);
        if (body && "redlineOverride" in body) updates.redlineOverride = clearable(body.redlineOverride);
        if (body && "shiftLightPercents" in body) updates.shiftLightPercents = clearable(body.shiftLightPercents);

        const updated = this.store.updateTune(segments[1], updates);
        if (!updated) {
          this.sendJson(res, 404, { error: "Tune not found" });
          return;
        }
        this.sendJson(res, 200, { tune: updated });
        return;
      }
      if (method === "DELETE") {
        const deleted = this.store.deleteTune(segments[1]);
        this.sendJson(res, deleted ? 200 : 404, { success: deleted });
        return;
      }
    }

    // GET/POST /tunes
    if (!segments[1]) {
      if (method === "GET") {
        const carOrdinal = Number(query.get("carOrdinal"));
        this.sendJson(res, 200, { tunes: this.store.listTunes(carOrdinal) });
        return;
      }
      if (method === "POST") {
        if (!body?.carOrdinal || !body?.name || !body?.gearRatios) {
          this.sendJson(res, 400, {
            error: "carOrdinal, name, and gearRatios are required",
          });
          return;
        }
        const tune = this.store.createTune(
          Number(body.carOrdinal),
          String(body.name),
          body.gearRatios,
          {
            maxRpmOverride: body.maxRpmOverride,
            maxRpmPerGearOverride: body.maxRpmPerGearOverride,
            redlineOverride: body.redlineOverride,
            shiftLightPercents: body.shiftLightPercents,
          },
        );
        this.sendJson(res, 201, { tune });
        return;
      }
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
