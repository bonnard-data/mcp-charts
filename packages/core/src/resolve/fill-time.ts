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

  // Bucket rows to the granularity (a 14:30 timestamp belongs to its day/month bucket, not to
  // an hour that the midnight-aligned sequence can never match). A bucket may hold several rows.
  // Week buckets anchor to the sequence start: UTC midnight of the min's day.
  const anchor = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), min.getUTCDate()));
  const key = (d: Date) => dateKey(d, granularity, anchor);
  const existing = new Map<string, Record<string, unknown>[]>();
  const emitted = new Set<Record<string, unknown>>();
  for (const row of data) {
    const date = parseUTC(String(row[xKey]));
    if (!date) continue;
    const k = key(date);
    const list = existing.get(k) ?? [];
    list.push(row);
    existing.set(k, list);
  }

  const result: Record<string, unknown>[] = [];
  for (const date of allDates) {
    const found = existing.get(key(date));
    if (found) {
      for (const row of found) {
        result.push(row);
        emitted.add(row);
      }
    } else {
      const nullRow: Record<string, unknown> = { [xKey]: toISOish(date) };
      for (const mk of measureKeys) nullRow[mk] = null;
      result.push(nullRow);
    }
  }
  // Gap-filling must never DROP data: keep any row the sequence didn't cover (unparseable x,
  // or a bucket outside the generated range).
  for (const row of data) if (!emitted.has(row)) result.push(row);
  return result;
}

function parseUTC(str: string): Date | null {
  let s = str.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(" ", "T"); // SQL-style datetime
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !s.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(s)) {
    s += "Z";
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    s += "T00:00:00.000Z";
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const WEEK_MS = 7 * 86_400_000;

// Truncate a date to its granularity bucket. Weeks are anchored to the sequence start (the
// sequence steps 7 days from `anchor`, not from ISO Mondays).
function dateKey(d: Date, granularity: TimeGranularity, anchor: Date): string {
  const y = d.getUTCFullYear();
  switch (granularity) {
    case "year":
      return String(y);
    case "quarter":
      return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    case "month":
      return `${y}-${pad(d.getUTCMonth() + 1)}`;
    case "week":
      return `W${Math.floor((d.getTime() - anchor.getTime()) / WEEK_MS)}`;
    default:
      return `${y}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
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
