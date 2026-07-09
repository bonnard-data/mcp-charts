// Shared value formatters: ChartSpec format descriptors -> display strings.
// Used by both the ECharts adapter (spec-to-option) and the legacy SVG fallback (render).
import type { FieldFormat, TimeGranularity } from "@bonnard/mcp-charts";

export type Format = FieldFormat;

export const esc = (s: unknown) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Format a measure value by its declared format (currency/percent/number). Axis ticks and
// tooltips abbreviate K/M for density; tables pass abbreviate=false to show full, exact numbers.
// `fraction` is the per-column percent scale decided at resolve time (0-1 fraction vs already-
// percent); when a spec doesn't carry it, fall back to the per-value guess.
export function fmt(v: unknown, f?: Format, currency?: string, fraction?: boolean, abbreviate = true): string {
  const n = Number(v);
  if (v == null || Number.isNaN(n)) return v == null ? "" : String(v);
  if (f === "percent") return `${((fraction ?? Math.abs(n) <= 1) ? n * 100 : n).toFixed(1)}%`;
  const full = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const abbr = (x: number) =>
    Math.abs(x) >= 1e6
      ? `${(x / 1e6).toFixed(1)}M`
      : Math.abs(x) >= 1e3
        ? `${(x / 1e3).toFixed(1)}K`
        : String(Number.isInteger(x) ? x : x.toFixed(2));
  const num = abbreviate ? abbr : full;
  if (f === "currency") return `${currency === "USD" || !currency ? "$" : currency + " "}${num(n)}`;
  return abbreviate ? (Number.isInteger(n) ? n.toLocaleString() : abbr(n)) : full(n);
}

// Format an x-axis value: dates by granularity (e.g. "Apr 26"); everything else as-is.
export function fmtX(v: unknown, granularity?: TimeGranularity): string {
  if (!granularity) return String(v);
  let s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !s.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(s)) s += "Z";
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += "T00:00:00.000Z";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(v);
  const yy = String(d.getUTCFullYear()).slice(-2);
  switch (granularity) {
    case "year":
      return String(d.getUTCFullYear());
    case "quarter":
      return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${yy}`;
    case "month":
      return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
    default:
      return d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
  }
}
