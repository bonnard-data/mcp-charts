// Lightweight, fail-loud guards on the developer-returned data. Because the rows ultimately
// come from an LLM-authored query (so the TS type is a claim the model can break) and every
// chart renderer below us fails SILENTLY on a bad shape, we turn "invisible blank chart" into
// a clear, agent-correctable error. Cheap: structural check + sampled scalar check on the
// columns we actually plot. Never scans large result sets; never rejects carried-but-unplotted columns.
import type { ChartSpec } from "./types.js";

const SCALAR_TYPES = new Set(["string", "number", "boolean", "bigint"]);

function isScalar(v: unknown): boolean {
  return v == null || SCALAR_TYPES.has(typeof v) || v instanceof Date;
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
