// Shared hand-rolled CSV reader/writer for the small per-file "tables" used
// by GearboxTuneStore. Unlike the original copy of this code (which assumed
// every field was numeric or an ISO timestamp - never containing a comma or
// quote), this one properly quotes/escapes fields (RFC4180-style) since
// GearboxTuneStore persists free-text tune names that a user could
// reasonably put a comma in (e.g. "R33 - Biru, Turbo Kit").

import * as fs from "fs";
import * as path from "path";

export function readCsvRows(filePath: string): string[][] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8").trim();
  if (!content) return [];
  return content
    .split(/\r?\n/)
    .slice(1) // drop header row
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields;
}

function csvField(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function writeCsvRows(
  filePath: string,
  headers: string[],
  rows: (string | number)[][],
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [
    headers.map(csvField).join(","),
    ...rows.map((row) => row.map(csvField).join(",")),
  ];
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
}
