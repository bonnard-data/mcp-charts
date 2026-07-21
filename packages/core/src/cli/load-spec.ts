// Spec loading for the preview CLI: read a JSON file (or an arbitrary value) and narrow it to a
// ChartSpec/DashboardSpec with the same guards the widget uses, failing with actionable messages.
import { readFileSync } from "node:fs";
import { isChartSpec, isDashboardSpec } from "../dashboard.js";
import type { ChartSpec, DashboardSpec } from "../types.js";

export type PreviewSpec = ChartSpec | DashboardSpec;

/** A user-facing load/validation failure; the CLI prints `message` and exits 1. */
export class SpecLoadError extends Error {}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array (a spec is an object; did you pass raw rows?)";
  if (typeof value !== "object") return `a ${typeof value}`;
  const keys = Object.keys(value);
  return keys.length ? `an object with keys ${keys.slice(0, 8).join(", ")}` : "an empty object";
}

/** Narrow an arbitrary value to a spec, or throw a SpecLoadError naming what was found. */
export function coerceSpec(value: unknown, source: string): PreviewSpec {
  if (isDashboardSpec(value)) return value;
  if (isChartSpec(value)) return value;
  throw new SpecLoadError(
    `${source} is not a ChartSpec or DashboardSpec: got ${describe(value)}. ` +
      `Expected the JSON a chart tool returns in structuredContent: a ChartSpec ` +
      `({ chartType, data: [...], ... }) or a DashboardSpec ({ items: [...], ... }).`,
  );
}

/** Parse a JSON string into a spec. */
export function parseSpec(raw: string, source: string): PreviewSpec {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SpecLoadError(`${source} is not valid JSON: ${message}`);
  }
  return coerceSpec(value, source);
}

/** Read + parse + validate a spec file. */
export function loadSpecFile(path: string): PreviewSpec {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SpecLoadError(`cannot read ${path}: ${message}`);
  }
  return parseSpec(raw, path);
}
