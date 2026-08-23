// Records every telemetry frame of a timed lap/race to SQLite, so a session
// can be replayed and analyzed later (see the session-recording pivot this
// project made away from predictive shift learning, toward fh6-tel's proven
// record/replay/analyze model). Sessions are tagged by build key (the same
// `activeTune?.id ?? computeBuildKey(meta)` TelemetryProcessor already
// computes), not just car_ordinal - this is what lets sessions be grouped
// and compared per build/tune, something a tool that only keys by
// car_ordinal structurally can't do.
//
// Storage is `node:sqlite` (built into Node since 22.5, no native-binary
// dependency) rather than this project's existing CSV read-whole-file/
// rewrite-whole-file pattern (see csv-store.ts): a session can be tens of
// thousands of frames, and rewriting an ever-growing file on every frame
// inside the same hot path that also does UDP parsing + WS broadcast would
// visibly stall live telemetry.
//
// Session start is gated on `isRaceOn === 1` alone. `lap.number` was
// originally meant to tighten this (only start once a lap has actually begun
// timing, not just "not in a menu"), but Fh6TelemetryParser.parse() computes
// it as `rawLapNumber + 1` unconditionally (see parser.ts) - so the field can
// never actually read 0 through this pipeline, and can't distinguish
// "no lap yet" from "on lap 1". It's still recorded per-frame below (useful
// for grouping frames by lap during replay/analysis), just not usable as a
// session-boundary signal.
//
// NOTE: `isRaceOn` is known in general Forza telemetry practice to also read
// 1 during ordinary free-roam driving, not just formal timed events, so this
// gate is a hypothesis that still needs an in-game verification pass (record
// a real timed event vs. free-roam and compare, see the session-recording
// pivot plan) before being fully trusted. It isn't blocking this
// implementation, since the gate degrades safely (worst case: some free-roam
// driving gets recorded as a low-value "session" that's easy to delete).
//
// Session END can't symmetrically watch for `isRaceOn === 0`, though:
// Fh6TelemetryParser.parse() already rejects isRaceOn=0 packets outright
// (returns null before they ever reach TelemetryProcessor), since the rest
// of the pipeline has no use for non-race frames. That means onFrame simply
// stops being called at all once a timed event ends - there's no frame left
// to observe the transition on. The actual end-of-session mechanism is an
// idle timeout: a periodic timer finalizes any session that hasn't received
// a frame in IDLE_TIMEOUT_MS, since Forza keeps sending Data Out packets at
// its usual rate the whole time (just no longer ones the parser accepts).

import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { TelemetryData } from "../types/telemetry";

export type SessionStatus = "recording" | "completed" | "aborted";

export interface SessionSummary {
  id: string;
  buildKey: string;
  carOrdinal: number;
  // Captured once at session start (per-car constants, not per-frame data) -
  // lets a replay viewer scale a gauge correctly without re-deriving them.
  maxRpm: number;
  idleRpm: number;
  startedAt: number;
  endedAt: number | null;
  frameCount: number;
  status: SessionStatus;
}

export interface SessionFrame {
  frameIndex: number;
  timestampMs: number;
  lapNumber: number | null;
  lapCurrent: number | null;
  lapLast: number | null;
  lapBest: number | null;
  raceTime: number | null;
  position: number | null;
  rpm: number;
  speed: number;
  gear: number;
  throttle: number;
  brake: number;
}

export class SessionRecorder {
  private readonly db: DatabaseSync;
  private activeSessionId: string | null = null;
  private activeBuildKey: string | null = null;
  private frameIndex = 0;
  private lastFrameAt = 0;
  private readonly idleCheckTimer: NodeJS.Timeout;
  /** Sessions with fewer frames than this on finalize are marked 'aborted'
   * instead of 'completed' - not a real drive, not worth surfacing by
   * default. */
  private static readonly MIN_FRAMES_FOR_COMPLETED = 10;
  /** How long a session can go without a new frame before it's assumed over
   * - see the file doc comment for why this (not an isRaceOn=0 frame) is
   * the actual end-of-session signal. Overridable (and the check interval
   * with it) so tests don't have to wait out the real 10s default. */
  private readonly idleTimeoutMs: number;

  constructor(
    baseDir: string = path.join(process.cwd(), "data", "db"),
    idleTimeoutMs = 10_000,
    idleCheckIntervalMs = 2_000,
  ) {
    this.idleTimeoutMs = idleTimeoutMs;
    fs.mkdirSync(baseDir, { recursive: true });
    this.db = new DatabaseSync(path.join(baseDir, "sessions.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        build_key TEXT NOT NULL,
        car_ordinal INTEGER NOT NULL,
        max_rpm REAL NOT NULL,
        idle_rpm REAL NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        frame_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'recording'
      )
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_sessions_build_key ON sessions(build_key)",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS frames (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        frame_index INTEGER NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        lap_number INTEGER,
        lap_current REAL,
        lap_last REAL,
        lap_best REAL,
        race_time REAL,
        position INTEGER,
        rpm REAL NOT NULL,
        speed REAL NOT NULL,
        gear INTEGER NOT NULL,
        throttle REAL NOT NULL,
        brake REAL NOT NULL,
        PRIMARY KEY (session_id, frame_index)
      )
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_frames_session_lap ON frames(session_id, lap_number)",
    );

    this.idleCheckTimer = setInterval(
      () => this.checkIdle(),
      idleCheckIntervalMs,
    );
    this.idleCheckTimer.unref(); // don't keep the process alive just for this
  }

  private checkIdle(): void {
    if (
      this.activeSessionId &&
      Date.now() - this.lastFrameAt > this.idleTimeoutMs
    ) {
      this.finalizeActiveSession();
    }
  }

  /** Call from TelemetryProcessor.handleCarChange whenever the build key
   * changes - finalizes any in-progress session for the OLD build first, so
   * a car/tune swap mid-drive never attributes frames to the wrong build. */
  onBuildChange(buildKey: string): void {
    if (this.activeSessionId && this.activeBuildKey !== buildKey) {
      this.finalizeActiveSession();
    }
  }

  /** Call once per processed frame. Starts recording based on isRaceOn (see
   * file doc comment for why lap.number can't tighten this further) and
   * appends a frame row while a session is active; ending is normally
   * driven by the idle timer, not this method (see file doc comment) - the
   * `!isRaceOn` branch below is a no-op through the live pipeline today but
   * kept as a correct, harmless fallback in case a caller ever does pass an
   * isRaceOn=0 frame here directly. */
  onFrame(telemetry: TelemetryData, buildKey: string): void {
    this.lastFrameAt = Date.now();
    const isRaceOn = telemetry.isRaceOn === 1;

    if (!this.activeSessionId) {
      if (isRaceOn) {
        this.startSession(buildKey, telemetry);
      }
    } else if (!isRaceOn) {
      this.finalizeActiveSession();
    }

    if (this.activeSessionId) {
      this.insertFrame(telemetry);
    }
  }

  private startSession(buildKey: string, telemetry: TelemetryData): void {
    this.activeSessionId = randomUUID();
    this.activeBuildKey = buildKey;
    this.frameIndex = 0;
    this.db
      .prepare(
        `INSERT INTO sessions (id, build_key, car_ordinal, max_rpm, idle_rpm, started_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'recording')`,
      )
      .run(
        this.activeSessionId,
        buildKey,
        telemetry.car.ordinal,
        telemetry.engine.maxRpm,
        telemetry.engine.idleRpm,
        Date.now(),
      );
  }

  private insertFrame(telemetry: TelemetryData): void {
    this.db
      .prepare(
        `INSERT INTO frames (
          session_id, frame_index, timestamp_ms,
          lap_number, lap_current, lap_last, lap_best, race_time, position,
          rpm, speed, gear, throttle, brake
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.activeSessionId,
        this.frameIndex++,
        Date.now(),
        telemetry.lap.number,
        telemetry.lap.current,
        telemetry.lap.last,
        telemetry.lap.best,
        telemetry.lap.raceTime,
        telemetry.lap.position,
        telemetry.engine.rpm,
        telemetry.performance.speedKmh,
        telemetry.input.gear,
        telemetry.input.throttle,
        telemetry.input.brake,
      );
    this.db
      .prepare("UPDATE sessions SET frame_count = ? WHERE id = ?")
      .run(this.frameIndex, this.activeSessionId);
  }

  /** Marks any in-progress session finished - 'completed' if it has enough
   * frames to be a real drive, 'aborted' otherwise. Call this on graceful
   * shutdown too, so a force-kill mid-session isn't the only way a session
   * gets left in 'recording' status forever. */
  finalizeActiveSession(): void {
    if (!this.activeSessionId) return;

    const status: SessionStatus =
      this.frameIndex >= SessionRecorder.MIN_FRAMES_FOR_COMPLETED
        ? "completed"
        : "aborted";

    this.db
      .prepare(
        "UPDATE sessions SET ended_at = ?, status = ? WHERE id = ?",
      )
      .run(Date.now(), status, this.activeSessionId);

    this.activeSessionId = null;
    this.activeBuildKey = null;
    this.frameIndex = 0;
  }

  listSessions(buildKey?: string): SessionSummary[] {
    const rows = buildKey
      ? this.db
          .prepare(
            "SELECT * FROM sessions WHERE build_key = ? ORDER BY started_at DESC",
          )
          .all(buildKey)
      : this.db.prepare("SELECT * FROM sessions ORDER BY started_at DESC").all();
    return rows.map((row) => this.hydrateSummary(row));
  }

  getSession(id: string): SessionSummary | null {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id);
    return row ? this.hydrateSummary(row) : null;
  }

  getFrames(id: string, lapNumber?: number): SessionFrame[] {
    const rows = lapNumber !== undefined
      ? this.db
          .prepare(
            "SELECT * FROM frames WHERE session_id = ? AND lap_number = ? ORDER BY frame_index",
          )
          .all(id, lapNumber)
      : this.db
          .prepare("SELECT * FROM frames WHERE session_id = ? ORDER BY frame_index")
          .all(id);
    return rows.map((row) => this.hydrateFrame(row));
  }

  deleteSession(id: string): boolean {
    this.db.prepare("DELETE FROM frames WHERE session_id = ?").run(id);
    const result = this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /** Call on graceful shutdown: finalizes any in-progress session, stops the
   * idle-check timer, and closes the database connection. */
  close(): void {
    this.finalizeActiveSession();
    clearInterval(this.idleCheckTimer);
    this.db.close();
  }

  private hydrateSummary(row: any): SessionSummary {
    return {
      id: row.id,
      buildKey: row.build_key,
      carOrdinal: row.car_ordinal,
      maxRpm: row.max_rpm,
      idleRpm: row.idle_rpm,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      frameCount: row.frame_count,
      status: row.status,
    };
  }

  private hydrateFrame(row: any): SessionFrame {
    return {
      frameIndex: row.frame_index,
      timestampMs: row.timestamp_ms,
      lapNumber: row.lap_number,
      lapCurrent: row.lap_current,
      lapLast: row.lap_last,
      lapBest: row.lap_best,
      raceTime: row.race_time,
      position: row.position,
      rpm: row.rpm,
      speed: row.speed,
      gear: row.gear,
      throttle: row.throttle,
      brake: row.brake,
    };
  }
}
