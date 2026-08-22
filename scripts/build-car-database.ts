// Merges the FM8 (Forza Motorsport) and FH6 (Forza Horizon 6) car ordinal
// datasets into one lookup table, `src/data/car-database.json`, keyed by
// car_id. Both games broadcast the same UDP telemetry format and share the
// same underlying car-ordinal ID space (verified 2026-08-22: 398 overlapping
// ids between the two source dumps, 0 cases of the same ordinal resolving to
// a different physical car - only cosmetic naming differences), so one
// merged table lets the app recognize cars from either game.
//
// FM8 is preferred whenever both sources have an id: its Year/Make/Model
// columns come straight from the game's own data, while FH6's are heuristically
// cleaned from asset filenames (see its own README) and occasionally garble
// spacing/capitalization. FH6 fills in the ~240 ids FM8's dump doesn't have
// (Horizon-only cars), and also patches the couple of FM8 rows with a blank
// model field.
//
// Re-run with: npx ts-node scripts/build-car-database.ts

import * as fs from "fs";
import * as path from "path";

interface CarEntry {
  carId: number;
  year: number;
  make: string;
  model: string;
  displayName: string;
}

const SOURCES_DIR = path.join(__dirname, "car-sources");
const OUTPUT_PATH = path.join(__dirname, "..", "src", "data", "car-database.json");

function parseDelimited(content: string, delimiter: string): string[][] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(delimiter));
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function buildDisplayName(year: string, make: string, model: string): string {
  return `${year} ${make} ${model}`.replace(/\s+/g, " ").trim();
}

function loadFm8(): Map<number, CarEntry> {
  const raw = stripBom(fs.readFileSync(path.join(SOURCES_DIR, "fm8-cars.csv"), "utf-8"));
  const rows = parseDelimited(raw, ",");
  const entries = new Map<number, CarEntry>();

  for (const [carIdRaw, year, make, model = ""] of rows) {
    const carId = Number(carIdRaw);
    if (!Number.isFinite(carId)) continue;
    entries.set(carId, {
      carId,
      year: Number(year),
      make,
      model,
      displayName: buildDisplayName(year, make, model),
    });
  }

  return entries;
}

function loadFh6(): Map<number, CarEntry> {
  const raw = stripBom(fs.readFileSync(path.join(SOURCES_DIR, "fh6-cars.csv"), "utf-8"));
  const [header, ...rows] = parseDelimited(raw, ";");
  const columns = header.map((c) => c.trim());
  const idxCarId = columns.indexOf("car_id");
  const idxYear = columns.indexOf("year");
  const idxMake = columns.indexOf("make");
  const idxModel = columns.indexOf("model");

  const entries = new Map<number, CarEntry>();
  for (const row of rows) {
    const carId = Number(row[idxCarId]);
    if (!Number.isFinite(carId)) continue;
    const year = row[idxYear];
    const make = row[idxMake];
    const model = row[idxModel];
    entries.set(carId, {
      carId,
      year: Number(year),
      make,
      model,
      displayName: buildDisplayName(year, make, model),
    });
  }

  return entries;
}

function main(): void {
  const fm8 = loadFm8();
  const fh6 = loadFh6();

  const merged: Record<string, CarEntry> = {};
  const allIds = new Set([...fm8.keys(), ...fh6.keys()]);

  for (const carId of allIds) {
    const primary = fm8.get(carId);
    const fallback = fh6.get(carId);

    if (primary) {
      // FM8 wins, but borrow FH6's model when FM8's is blank (a couple of
      // rows in the FM8 dump are missing it).
      const model = primary.model.trim() || fallback?.model || "";
      merged[carId] = {
        ...primary,
        model,
        displayName: buildDisplayName(String(primary.year), primary.make, model),
      };
    } else if (fallback) {
      merged[carId] = fallback;
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");

  console.log(
    `Wrote ${Object.keys(merged).length} car entries to ${path.relative(process.cwd(), OUTPUT_PATH)} ` +
      `(fm8: ${fm8.size}, fh6: ${fh6.size}, fm8-only: ${[...fm8.keys()].filter((id) => !fh6.has(id)).length}, ` +
      `fh6-only: ${[...fh6.keys()].filter((id) => !fm8.has(id)).length})`,
  );
}

main();
