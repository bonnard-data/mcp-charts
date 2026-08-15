// Lightweight, fail-loud guards on the developer-returned data. Because the rows ultimately
// come from an LLM-authored query (so the TS type is a claim the model can break) and every
// chart renderer below us fails SILENTLY on a bad shape, we turn "invisible blank chart" into
// a clear, agent-correctable error. Cheap: structural check + sampled scalar check on the
// columns we actually plot. Never scans large result sets; never rejects carried-but-unplotted columns.
import type { ChartData, ChartSpec, Decision } from "./types.js";
import { decision } from "./resolve/decisions.js";

const SCALAR_TYPES = new Set(["string", "number", "boolean", "bigint"]);
const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;

function isScalar(v: unknown): boolean {
  return v == null || SCALAR_TYPES.has(typeof v) || v instanceof Date;
}

/** A value that is a number stored as a string (e.g. "1234", "-9.5") — the classic driver footgun. */
export function isNumericString(v: unknown): boolean {
  return typeof v === "string" && NUMERIC_STRING.test(v);
}

/** A 4-digit value (as string or number) in a plausible year range — a legitimate string/number
 *  ambiguity we must NOT coerce to a measure. Shares the 1900-2100 window with sniffTimeGranularity
 *  so recovery, inference, and warnUntypedColumns agree on what "year-like" means. */
export function isYearLike(v: unknown): boolean {
  const s = String(v);
  if (!/^\d{4}$/.test(s)) return false;
  const y = Number(s);
  return y >= 1900 && y <= 2100;
}

/** Non-null sampled values are ALL numeric strings and NONE is year-like: safe to treat as a
 *  number column. Returns false for an empty sample. Used by both warnUntypedColumns (advisory)
 *  and inference recovery (typing) so behavior matches. */
export function allNumericStrings(values: unknown[]): boolean {
  const vals = values.filter((v) => v != null);
  if (vals.length === 0) return false;
  return vals.every(isNumericString) && !vals.every(isYearLike);
}

/** Generic shape check: the data source must return rows as an array of flat objects. */
export function validateRowsShape(rows: unknown): asserts rows is Record<string, unknown>[] {
  if (!Array.isArray(rows)) {
    throw new Error(
      `Expected the data source to return { rows: [...] } as an array of objects; got ${rows === null ? "null" : typeof rows}.`,
    );
  }
  if (rows.length === 0) return;
  const first = rows[0];
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    throw new Error(
      `Each row must be a flat object keyed by column name (e.g. { region: "EU", revenue: 100 }); ` +
        `got ${Array.isArray(first) ? "an array" : typeof first}. ` +
        `If your driver returns arrays, map each row to an object first.`,
    );
  }
}

// A column typed only by inference (no declared `kind`) whose values are numbers-stored-as-strings
// or driver wrapper objects is the classic integration footgun: resolve() then charts numbers as
// categories, or blanks the chart on objects. This is a wiring mistake in the caller's runSql (a
// SQL driver that string-encodes numerics, or hands back Date/wrapper objects), not bad data, so it
// warns the developer rather than throwing. Silent when the caller declared `fields` (kinds win).
export function untypedColumnDecisions(data: ChartData, sample = 50): Decision[] {
  const declared = new Set((data.fields ?? []).filter((f) => f.kind).map((f) => f.name));
  const rows = data.rows.slice(0, sample);
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const out: Decision[] = [];
  for (const c of cols) {
    if (declared.has(c)) continue;
    const vals = rows.map((r) => r[c]).filter((v) => v != null);
    if (vals.length === 0) continue;
    // Skip all-4-digit columns: a bare year is a legitimate string/number ambiguity we must not force.
    if (allNumericStrings(vals)) {
      out.push(decision("coerced_numeric_strings", { column: c }));
    } else if (vals.some((v) => typeof v === "object" && !(v instanceof Date))) {
      out.push(decision("driver_wrapped_values", { column: c }));
    }
  }
  return out;
}

/** The messages of untypedColumnDecisions. */
export function warnUntypedColumns(data: ChartData, sample = 50): string[] {
  return untypedColumnDecisions(data, sample).map((d) => d.message);
}

/** Merge the integrator advisories for `data` into `spec`, deduped by message. These are
 *  "recovered" signals (the chart still renders), so they ride the spec rather than throwing. */
export function mergeAdvisories(spec: ChartSpec, data: ChartData): ChartSpec {
  const advisories = untypedColumnDecisions(data);
  if (advisories.length === 0) return spec;
  const decisions = [...(spec.decisions ?? [])];
  const seen = new Set(decisions.map((d) => d.message));
  for (const a of advisories) {
    if (seen.has(a.message)) continue;
    seen.add(a.message);
    decisions.push(a);
  }
  return { ...spec, notes: decisions.map((d) => d.message), decisions };
}

/** Precise check: every column we actually plot (x + series) must hold scalar values. Sampled. */
export function assertPlottedScalar(spec: ChartSpec, sample = 50): void {
  const keys = [spec.x, ...spec.series.map((s) => s.key)].filter(Boolean);
  for (const row of spec.data.slice(0, sample)) {
    for (const k of keys) {
      const v = row[k];
      if (!isScalar(v)) {
        const kind = Array.isArray(v) ? "an array" : "an object";
        throw new Error(
          `Column "${k}" contains ${kind}, but charts need scalar values. ` +
            `Select a field of it (e.g. ${k}.id) or cast it to text in your query.`,
        );
      }
    }
  }
}
