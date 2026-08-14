// How the harness turns a fixture into something the widget can render, imported FROM CORE SOURCE
// so editing inference hot-reloads the preview.
//
// The pipeline is `mergeAdvisories(resolve(...))`, which is what chart() itself runs. A bare
// resolve() is a shorter path than any consumer takes: the integrator advisories
// (numbers-as-strings, driver-wrapped values) are produced by mergeAdvisories alone, so a harness
// built on resolve() could never show them, and the two decision kinds that report them had no
// reachable example.
import { resolve } from "../../../core/src/resolve/resolve.js";
import { mergeAdvisories } from "../../../core/src/validate.js";
import type { ChartData, ChartSpec, DashboardSpec, ResolveOptions } from "@bonnard/mcp-charts";

export type Payload = ChartSpec | DashboardSpec;

/** The production path: infer + shape, then merge the advisories about the data it was given. */
export function buildChartSpec(data: ChartData, opts: ResolveOptions = {}): ChartSpec {
  return mergeAdvisories(resolve(data, opts), data);
}

export interface EditorInput {
  data: ChartData;
  opts?: ResolveOptions;
}

export type BuildOutcome = { ok: true; payload: Payload } | { ok: false; error: string };

/**
 * Parse the overlay's JSON pane. `input` is `{ data, opts }` fed through the pipeline above;
 * `spec` is a hand-written ChartSpec/DashboardSpec handed to the renderer untouched, which is the
 * only way to exercise a shape resolve() would never produce.
 */
export function buildFromJson(text: string, view: "input" | "spec"): BuildOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    if (view === "spec") return { ok: true, payload: parsed as Payload };
    const { data, opts } = parsed as EditorInput;
    if (!data || !Array.isArray(data.rows)) return { ok: false, error: "Expected { data: { rows: [...] }, opts }" };
    return { ok: true, payload: buildChartSpec(data, opts ?? {}) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
