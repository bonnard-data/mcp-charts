// Decisions: the structured form of everything resolve() reports about what it did to the data.
// One kind per situation, one message renderer, one audience map — so a caption a viewer sees, a
// config mistake the author must fix, and a data-trust signal an agent branches on stay separable.
// `ChartSpec.notes` is derived from these (`decisions.map(d => d.message)`), so the message strings
// here are the single source of that wording.
import type { Decision, DecisionAudience, DecisionKind } from "../types.js";

export type DecisionData = Record<string, string | number | boolean | string[]>;

/**
 * Who each kind is for. `author` = the view's own configuration or misuse; `viewer` = presentation
 * honesty about what is currently drawn; `agent` = whether the returned data is safe to compute on.
 * A kind belongs to as many as apply.
 */
const AUDIENCES: Record<DecisionKind, DecisionAudience[]> = {
  encode_unknown_column: ["author"],
  loose_dates: ["author"],
  dedupe_sum: ["agent"],
  rate_sum_hazard: ["agent"],
  y2_dropped_on_pivot: ["author"],
  series_fold: ["viewer"],
  no_measure: ["author", "agent"],
  forced_type_mismatch: ["author"],
  bar_cap: ["viewer", "agent"],
  downsample: ["viewer", "agent"],
  scatter_sample: ["viewer", "agent"],
  pie_fold: ["viewer"],
  pie_negative_magnitudes: ["viewer"],
  waterfall_totals_guess: ["author"],
  coerced_numeric_strings: ["author"],
  driver_wrapped_values: ["author"],
  result_truncated: ["agent"],
  item_error: ["agent"],
  consumer_note: ["viewer", "agent"],
};

/** Every kind, from the one map that has to list them all. A test walks this to prove each kind
 *  still has a worked example, which a type-level union cannot do at runtime. */
export const DECISION_KINDS = Object.keys(AUDIENCES) as DecisionKind[];

export function audiencesFor(kind: DecisionKind): DecisionAudience[] {
  return [...AUDIENCES[kind]];
}

/** Render a decision's human sentence from its payload. */
export function decisionMessage(kind: DecisionKind, data: DecisionData = {}): string {
  const str = (k: string) => String(data[k] ?? "");
  const num = (k: string) => Number(data[k] ?? 0);
  const list = (k: string) => (Array.isArray(data[k]) ? data[k] : []);
  const quoted = (k: string) =>
    list(k)
      .map((v) => `"${v}"`)
      .join(", ");

  switch (kind) {
    case "encode_unknown_column":
      return (
        `Ignored unknown encode column${list("columns").length > 1 ? "s" : ""} ${quoted("columns")}; ` +
        `available: ${list("available").join(", ")}.`
      );
    case "loose_dates":
      return (
        `Column "${str("column")}" looks like non-ISO dates; plotted as unordered categories. ` +
        `Return ISO dates (YYYY-MM-DD) for a sorted time axis.`
      );
    case "dedupe_sum":
      return data.seriesDimension
        ? `Summed ${num("collapsed")} row(s) that shared the same ${str("x")} + ${str("seriesDimension")} — the data looked unaggregated.`
        : `Summed ${num("collapsed")} row(s) that shared the same ${str("x")} — the data looked unaggregated.`;
    case "rate_sum_hazard":
      return `${quoted("columns")} looks like a rate; summing rates is usually wrong — compute SUM(numerator)/SUM(denominator) in SQL instead.`;
    case "y2_dropped_on_pivot":
      return `Secondary-axis measure(s) ${quoted("columns")} were dropped because the chart is split into series by ${str("seriesDimension")}.`;
    case "series_fold":
      return `Grouped ${num("folded")} smaller ${data.group === "categories" ? "categories" : "series"} into "Other".`;
    case "no_measure":
      return "No measure column to plot - the chart has no data series. Check that value columns contain numbers (not strings), or declare types via fields.";
    case "forced_type_mismatch":
      if (data.chartType === "pie") {
        return `A pie needs one category + one measure; got ${num("measures")} measures - showing them as separate slices, which is usually not what a pie means.`;
      }
      if (data.chartType === "line") {
        return `A line over categorical "${str("column")}" implies an order that may not exist; consider a bar chart.`;
      }
      return `A funnel needs a stage/label column and one measure; got only measures - using "${str("column")}" values as stage labels.`;
    case "bar_cap":
      return `Showing the top ${num("kept")} of ${num("total")} categories by value.`;
    case "downsample":
      return `Downsampled ${num("from")} points to ${num("to")} for display.`;
    case "scatter_sample":
      return `Showing a sample of ${num("kept")} of ${num("total")} points.`;
    case "pie_fold":
      return `Grouped ${num("folded")} small slices into "Other".`;
    case "pie_negative_magnitudes":
      return "All values were negative — showing their magnitudes.";
    case "waterfall_totals_guess":
      return "No totals column found, so the first and last rows are treated as the opening and closing totals. Mark a column (e.g. type = total) to change this.";
    case "coerced_numeric_strings":
      return `Column "${str("column")}" arrived as numbers stored as strings; coerced to numbers so it can be plotted. Declare its kind or return numbers to silence this.`;
    case "driver_wrapped_values":
      return `Column "${str("column")}" holds objects (a driver-wrapped value?); normalize to a scalar or declare its fields.`;
    // Kinds a consumer emits (a truncated result, a failed cell, a passed-through note) carry
    // their own sentence.
    default:
      return str("message");
  }
}

/** Build one decision without logging it, e.g. to hand a consumer-owned sentence a kind. */
export function decision(kind: DecisionKind, data: DecisionData = {}): Decision {
  // A consumer_note's whole payload IS its sentence, so it carries no separate `data`.
  const payload = kind === "consumer_note" ? {} : data;
  return {
    kind,
    audiences: audiencesFor(kind),
    message: decisionMessage(kind, data),
    ...(Object.keys(payload).length > 0 && { data: payload }),
  };
}

/** Ordered collector: one call records the decision and its rendered message together. */
export class DecisionLog {
  private readonly items: Decision[] = [];

  push(kind: DecisionKind, data: DecisionData = {}): void {
    this.items.push(decision(kind, data));
  }

  add(...decisions: Decision[]): void {
    this.items.push(...decisions);
  }

  get size(): number {
    return this.items.length;
  }

  decisions(): Decision[] {
    return [...this.items];
  }

  messages(): string[] {
    return this.items.map((d) => d.message);
  }
}

/** A consumer's own advisories, structured. Their `decisions` win; bare `notes` become
 *  `consumer_note`s in the order they were given. */
export function consumerDecisions(source: { notes?: string[]; decisions?: Decision[] }): Decision[] {
  if (source.decisions?.length) return [...source.decisions];
  return (source.notes ?? []).map((message) => decision("consumer_note", { message }));
}
