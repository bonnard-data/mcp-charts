// Typing inference: turn a ChartData into a complete, role-tagged FieldMeta list.
// Priority: declared fields win; anything missing is sniffed from the row values.
// This is what lets resolve() decide x / y / series when the data source did not
// supply full typing (e.g. raw SQL rows).
import type { ChartData, FieldFormat, FieldKind, FieldMeta, FieldRole, TimeGranularity } from "../types.js";

// Period-string -> granularity. Lets the raw-SQL path recognize time buckets that aren't full ISO
// dates (e.g. strftime('%Y-%m') -> "2025-01") so time series are typed TEMPORAL — ordered, drawn
// vertically, nicely labelled — instead of being mistaken for high-cardinality categories. Used
// when the data source declares no column types, so the kind is inferred from the value shape.
export function sniffTimeGranularity(value: unknown): TimeGranularity | null {
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value)) return "day"; // 2025-01-15 or a full datetime
  if (/^\d{4}-\d{2}$/.test(value)) return "month"; // 2025-01
  if (/^\d{4}-?Q[1-4]$/i.test(value)) return "quarter"; // 2025-Q1 / 2025Q1
  if (/^\d{4}-W\d{2}$/i.test(value)) return "week"; // 2025-W03 (ISO week)
  if (/^\d{4}$/.test(value)) {
    const y = Number(value); // bare year as a string ("2025"); guard the range to avoid 4-digit codes
    if (y >= 1900 && y <= 2100) return "year";
  }
  return null;
}

// Granularity from the actual values. date_trunc('month'|'quarter'|'year'|'week') yields FULL
// dates, so a single value's shape reads as "day" and a monthly series gets ~30x null-filled
// into disconnected dots. Scan the distinct dates instead: all Jan 1 -> year, all first-of-
// quarter spaced like quarters -> quarter, all first-of-month -> month, all the same weekday ->
// week, else day. Period strings (YYYY-MM, YYYY-Qn, ...) state their own granularity; mixed or
// unparseable values bail out (null).
const DAY_MS = 86_400_000;
export function sniffGranularityFromValues(values: unknown[]): TimeGranularity | null {
  const seen = new Set<string>();
  const dates: Date[] = [];
  for (const v of values) {
    if (v == null) continue;
    const g = sniffTimeGranularity(v);
    if (g === null) return null;
    if (g !== "day") return g;
    const day = String(v).slice(0, 10);
    if (seen.has(day)) continue;
    seen.add(day);
    const d = new Date(`${day}T00:00:00.000Z`);
    if (isNaN(d.getTime())) return null;
    dates.push(d);
  }
  if (dates.length === 0) return null;
  if (dates.length === 1) return "day"; // one distinct date: no periodicity to read
  const times = dates.map((d) => d.getTime()).sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < times.length; i++) minGap = Math.min(minGap, times[i]! - times[i - 1]!);
  const all = (p: (d: Date) => boolean) => dates.every(p);
  if (all((d) => d.getUTCDate() === 1)) {
    if (all((d) => d.getUTCMonth() === 0)) return "year";
    // First-of-quarter alone also matches monthly data (Jan, Feb, ...); the gap disambiguates.
    if (all((d) => d.getUTCMonth() % 3 === 0) && minGap > 31 * DAY_MS) return "quarter";
    return "month";
  }
  if (all((d) => d.getUTCDay() === dates[0]!.getUTCDay())) return "week";
  return "day";
}

// One value can lie (a text column whose first value is "2024" or "2025-01-15" would type the
// whole column time/number), so sample several and require consensus; disagreement -> string.
const KIND_SAMPLE = 20;
export function sniffKind(rows: Record<string, unknown>[], name: string): FieldKind {
  const kindOf = (v: unknown): FieldKind => {
    if (typeof v === "number" || typeof v === "bigint") return "number";
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "string" && sniffTimeGranularity(v) !== null) return "time";
    return "string";
  };
  let kind: FieldKind | undefined;
  let seen = 0;
  for (const r of rows) {
    const v = r[name];
    if (v == null) continue;
    const k = kindOf(v);
    if (kind === undefined) kind = k;
    else if (k !== kind) return "string";
    if (++seen >= KIND_SAMPLE) break;
  }
  return kind ?? "string";
}

export function roleFromKind(kind: FieldKind): FieldRole {
  if (kind === "time") return "time";
  if (kind === "number") return "measure";
  return "dimension";
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Name-based hints — a purely conventional fallback used only when the data source declares no
// format/granularity. Centralized here so the adapter path (buildChartData) and the raw-rows path
// (inferFields) apply identical rules.

// A numeric column whose name reads as a rate/ratio renders as a percent. Currency is deliberately
// NOT guessed from names (the code is unknowable) — declare it. camelCase is normalized to snake.
export function formatHint(name: string): FieldFormat | undefined {
  const n = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  if (/(^|_)(rate|pct|percent|percentage|ratio)(_|$)/.test(n)) return "percent";
  return undefined;
}

// Granularity from the column name, for time columns whose values don't reveal it (e.g. a DATE
// named "week_start" holding full dates). Defaults to day.
export function granularityHint(name: string): TimeGranularity {
  const n = name.toLowerCase();
  if (n.includes("year")) return "year";
  if (n.includes("quarter")) return "quarter";
  if (n.includes("month")) return "month";
  if (n.includes("week")) return "week";
  return "day";
}

/** Complete field metadata for every column, declared values taking precedence. */
export function inferFields(data: ChartData): FieldMeta[] {
  const { rows, fields } = data;
  const declared = new Map((fields ?? []).map((f) => [f.name, f]));
  // Union of returned columns + any declared-only names: declaring fields for SOME columns
  // augments their typing, it does not drop the columns you didn't declare.
  const rowKeys = rows[0] ? Object.keys(rows[0]) : [];
  const names = [...rowKeys, ...[...declared.keys()].filter((n) => !rowKeys.includes(n))];

  return names.map((name) => {
    const d = declared.get(name);
    const kind: FieldKind = d?.kind ?? sniffKind(rows, name);
    const role: FieldRole = d?.role ?? roleFromKind(kind);
    // Time columns with no declared granularity: infer it from the values (YYYY-MM -> month,
    // all first-of-month full dates -> month). declared > value-scan > name-hint
    const granularity =
      d?.granularity ??
      (kind === "time"
        ? (sniffGranularityFromValues(rows.map((r) => r[name])) ?? granularityHint(name))
        : undefined);
    // declared > name-hint (rate -> percent); only for numeric columns
    const format = d?.format ?? (kind === "number" ? formatHint(name) : undefined);
    return {
      name,
      kind,
      role,
      label: d?.label ?? titleCase(name),
      ...(format && { format }),
      ...(granularity && { granularity }),
      ...(d?.additive != null && { additive: d.additive }),
      ...(d?.currency && { currency: d.currency }),
    };
  });
}
