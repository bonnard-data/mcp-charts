// Fill missing time intervals so renderers show gaps correctly. Detects min/max dates,
// generates all expected interval starts for the granularity, inserts null-measure rows
// for missing periods. Pure; timezone-safe (treats Cube-style no-Z strings as UTC).
import type { TimeGranularity } from "../types.js";

export function fillMissingTimeIntervals(
  data: Record<string, unknown>[],
  xKey: string,
  measureKeys: string[],
  granularity: TimeGranularity,
): Record<string, unknown>[] {
  if (data.length < 2) return data;

  const entries: { date: Date }[] = [];
  for (const row of data) {
    const date = parseUTC(String(row[xKey]));
    if (date) entries.push({ date });
  }
  if (entries.length < 2) return data;

  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  const min = entries[0]!.date;
  const max = entries[entries.length - 1]!.date;
  const allDates = generateSequence(min, max, granularity);

  const existing = new Map<string, Record<string, unknown>>();
  for (const row of data) {
    const date = parseUTC(String(row[xKey]));
    if (date) existing.set(dateKey(date), row);
  }

  const result: Record<string, unknown>[] = [];
  for (const date of allDates) {
    const found = existing.get(dateKey(date));
    if (found) {
      result.push(found);
    } else {
      const nullRow: Record<string, unknown> = { [xKey]: toISOish(date) };
      for (const mk of measureKeys) nullRow[mk] = null;
      result.push(nullRow);
    }
  }
  return result;
}

function parseUTC(str: string): Date | null {
  let s = str.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !s.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(s)) {
    s += "Z";
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    s += "T00:00:00.000Z";
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`;
}

function toISOish(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T00:00:00.000`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function generateSequence(start: Date, end: Date, granularity: TimeGranularity): Date[] {
  const dates: Date[] = [];
  const endTime = end.getTime();
  const MAX_INTERVALS = 10_000;
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  let d = start.getUTCDate();

  while (dates.length < MAX_INTERVALS) {
    const current = new Date(Date.UTC(y, m, d));
    if (current.getTime() > endTime) break;
    dates.push(current);
    switch (granularity) {
      case "day":
        d += 1;
        break;
      case "week":
        d += 7;
        break;
      case "month":
        m += 1;
        d = 1;
        break;
      case "quarter":
        m += 3;
        d = 1;
        break;
      case "year":
        y += 1;
        break;
      default:
        d += 1;
        break;
    }
  }
  return dates;
}
