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

// Compact a large magnitude to K/M/B/T notation (e.g. 8_000_000_000 -> "8B", 1_200_000 -> "1.2M").
// Small magnitudes (< 1000) pass through with separators. Used for value-axis tick labels, where
// full-digit labels ("8,000,000,000") crowd narrow cells and are hard to scan.
export function compact(n: number): string {
  const abs = Math.abs(n);
  const unit = (x: number, u: string) => {
    const s = (n / x).toFixed(1);
    return `${s.endsWith(".0") ? s.slice(0, -2) : s}${u}`;
  };
  if (abs >= 1e12) return unit(1e12, "T");
  if (abs >= 1e9) return unit(1e9, "B");
  if (abs >= 1e6) return unit(1e6, "M");
  if (abs >= 1e3) return unit(1e3, "K");
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2);
}

// Value-axis tick formatter honoring the axis's declared format. Compacts large magnitudes
// (currency and plain number) but never a percent axis — a percent tick is already small and
// compacting "80%" to "80" would be wrong.
export function fmtAxis(v: number, f?: Format, currency?: string): string {
  if (f === "percent") return fmt(v, f);
  if (f === "currency") return `${currency === "USD" || !currency ? "$" : currency + " "}${compact(v)}`;
  return compact(v);
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
