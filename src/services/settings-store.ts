// Persists the single global "General settings" config - currently just the
// default shift-light percentages applied when a car's active tune (or lack
// of one) doesn't specify its own (see TelemetryProcessor.computeEffectiveRpm).
// Mirrors SimHub's "General settings" tab (see the SimHub comparison
// research): a plain user-editable default, not anything derived/learned.
//
// A single JSON blob rather than a CSV table: this isn't a set of rows keyed
// by some id the way tunes/sessions are, it's one small config object, so
// forcing it through csv-store.ts's row-oriented helpers would be more
// contortion than clarity.

import * as fs from "fs";
import * as path from "path";
import { ShiftLightPercents } from "./gearbox-tune-store";

/** Seed value used the very first time settings.json doesn't exist yet -
 * SimHub's own defaults (90%/95%/96%). */
const BOOTSTRAP_SHIFT_LIGHT_PERCENTS: ShiftLightPercents = {
  light1: 0.9,
  light2: 0.95,
  redline: 0.96,
};

export interface GeneralSettings {
  shiftLightPercents: ShiftLightPercents;
}

export class SettingsStore {
  private readonly filePath: string;

  constructor(baseDir: string = path.join(process.cwd(), "data", "db")) {
    fs.mkdirSync(baseDir, { recursive: true });
    this.filePath = path.join(baseDir, "settings.json");
  }

  getGeneralSettings(): GeneralSettings {
    if (!fs.existsSync(this.filePath)) {
      return { shiftLightPercents: BOOTSTRAP_SHIFT_LIGHT_PERCENTS };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      return {
        shiftLightPercents: parsed.shiftLightPercents ?? BOOTSTRAP_SHIFT_LIGHT_PERCENTS,
      };
    } catch (error) {
      console.error("⚠️  Failed to read settings.json, using bootstrap defaults:", error);
      return { shiftLightPercents: BOOTSTRAP_SHIFT_LIGHT_PERCENTS };
    }
  }

  setGeneralSettings(settings: GeneralSettings): void {
    fs.writeFileSync(this.filePath, JSON.stringify(settings, null, 2));
  }
}
