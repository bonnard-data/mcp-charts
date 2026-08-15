// The source-agnostic data contract. SQL, semantic layer, or ORM all normalize to this.
// `resolve()` consumes it to derive the chart encoding (x / y / series / labels / formatting).

export type ChartType = "line" | "bar" | "area" | "pie" | "scatter" | "funnel" | "waterfall" | "table";

/** What a field IS, for charting purposes. */
export type FieldRole = "measure" | "dimension" | "time";
export type FieldKind = "number" | "string" | "time" | "boolean";
export type FieldFormat = "number" | "currency" | "percent";
export type TimeGranularity = "day" | "week" | "month" | "quarter" | "year";

/** Per-field typing — the metadata `resolve()` needs. Semantic layers supply this for
 *  free; SQL drivers supply name + kind; ORM/custom devs declare it once. */
export interface FieldMeta {
  name: string;
  role?: FieldRole;
  kind?: FieldKind;
  format?: FieldFormat;
  label?: string;
  granularity?: TimeGranularity;
  additive?: boolean;
  currency?: string;
}

/** Explicit encoding override, when field names don't make x/y/series obvious. */
export interface Encode {
  x?: string;
  y?: string | string[];
  series?: string;
  /** Measure(s) to plot on a secondary (right) y-axis, drawn as a line over the primary chart. */
  y2?: string | string[];
  /** Measure(s) to draw as a line instead of bars on the SAME axis (a combo, e.g. actual vs target). */
  line?: string | string[];
  /** Scatter only: a 3rd measure mapped to point size (turns a scatter into a bubble chart). */
  size?: string;
}

// --- Decisions: what resolve() did to the data, and who needs to know. ---

/**
 * Who a decision is for.
 *
 * `viewer` — a human looking at the rendered chart; presentational captions.
 * `author` — whoever builds or edits the view (human or agent); their own config mistakes.
 * `agent`  — an AI agent that called the tool; whether the returned data is safe to compute on.
 */
export type DecisionAudience = "viewer" | "author" | "agent";

/** The situations resolve() (and its consumers) report. Open: a consumer may add its own. */
export type DecisionKind =
  | "encode_unknown_column"
  | "loose_dates"
  | "dedupe_sum"
  | "rate_sum_hazard"
  | "y2_dropped_on_pivot"
  | "series_fold"
  | "no_measure"
  | "forced_type_mismatch"
  | "bar_cap"
  | "downsample"
  | "scatter_sample"
  | "pie_fold"
  | "pie_negative_magnitudes"
  | "waterfall_totals_guess"
  | "coerced_numeric_strings"
  | "driver_wrapped_values"
  | "result_truncated"
  | "item_error"
  | "consumer_note";

/** One thing that happened while resolving, addressed to the audiences it matters to. */
export interface Decision {
  kind: DecisionKind | (string & {});
  audiences: DecisionAudience[];
  message: string;
  /** The values behind the message (counts, dropped column names), for a machine to branch on. */
  data?: Record<string, string | number | boolean | string[]>;
}

/** The normalized result every data callback returns. */
export interface ChartData {
  rows: Record<string, unknown>[];
  fields?: FieldMeta[];
  encode?: Encode;
  /** Data-source advisories (e.g. "result truncated at the row cap") that resolve() merges
   *  into ChartSpec.notes so they surface on the chart. */
  notes?: string[];
  /** Structured form of the above. Anything only in `notes` is carried as a `consumer_note`. */
  decisions?: Decision[];
}

/** Context passed to data callbacks — extensible bag so the signature never breaks. */
export interface ChartContext {
  tenant?: string;
  roles?: string[];
  userId?: string;
  requestId?: string;
  signal?: AbortSignal;
}

export type Stacking = "stacked" | "grouped" | "stacked100";

// --- The resolved, render-ready spec. JSON-serializable: it crosses to the widget. ---
// Formatting is expressed as descriptors (format/granularity/currency), NOT functions —
// the widget applies them at render time.

export interface SeriesSpec {
  key: string;
  label: string;
  /** Which y-axis this series belongs to. "right" series render as a line (dual-axis combo). */
  axis?: "left" | "right";
  /** Render this series as a line instead of the chart's base type (same-axis combo). */
  type?: "bar" | "line";
}

export interface AxisSpec {
  label?: string;
  format?: FieldFormat;
  granularity?: TimeGranularity;
  currency?: string;
  /** x-axis only: values are numeric, so line/area render on a linear (value) scale, not categories. */
  numeric?: boolean;
  /** percent only: values are 0-1 fractions (renderer scales by 100). Decided once per column
   *  at resolve time so a series crossing 1.0 doesn't flip scale between adjacent values. */
  fraction?: boolean;
}

export interface ColumnSpec {
  key: string;
  label: string;
  format?: FieldFormat;
  granularity?: TimeGranularity;
  currency?: string;
  /** percent only: values are 0-1 fractions (renderer scales by 100). See AxisSpec.fraction. */
  fraction?: boolean;
}

/** A horizontal reference line on the value axis (target, average, threshold). */
export interface ReferenceLine {
  value: number;
  label: string;
}

/** Output of resolve() — everything a renderer needs, fully serializable. */
export interface ChartSpec {
  chartType: ChartType;
  /** Cleaned + (if needed) pivoted/time-filled rows, ready to plot. */
  data: Record<string, unknown>[];
  /** x-axis key ("" for a single-measure table). */
  x: string;
  series: SeriesSpec[];
  xAxis?: AxisSpec;
  yAxis?: AxisSpec;
  /** Secondary (right) y-axis descriptor, present only for dual-axis combo charts. */
  yAxisRight?: AxisSpec;
  legend: boolean;
  stacking?: Stacking;
  horizontal?: boolean;
  title?: string;
  columns?: ColumnSpec[];
  /** Horizontal reference lines on the value axis (target / average). */
  reference?: ReferenceLine[];
  /** Scatter only: column mapped to point size (bubble chart). */
  size?: string;
  /** Scatter only: a dimension column used to label/identify each point (tooltip). */
  pointLabel?: string;
  /** Waterfall only: step labels that are totals (full bars anchored at 0), not floating deltas. */
  totals?: string[];
  /** Every decision's message, in order. A back-compatible projection of `decisions`; new code
   *  should read `decisions` and filter by audience. */
  notes?: string[];
  /** What resolve() did to the data, each addressed to the audiences it matters to. */
  decisions?: Decision[];
}

/** Options to resolve(), typically sourced from the agent's tool args. */
export interface ResolveOptions {
  chartType?: ChartType | "auto";
  title?: string;
  stacking?: Stacking;
  /** Run bars horizontally (categories on the y-axis). Bars are vertical unless you set this. */
  horizontal?: boolean;
  /** Add reference lines: an average (computed) and/or a target (a value you pass). */
  reference?: { target?: number; average?: boolean };
  /** Force how a numeric x-axis is scaled, overriding inference. "categorical" plots the values as
   *  evenly-spaced labels (a GROUP BY year reads as buckets, not a timeline); "continuous" keeps the
   *  linear scale. Unset infers from the column's kind. */
  xAxisType?: "continuous" | "categorical";
  /** Promote encoding-failure advisories (zero series, ignored encode column) from notes to
   *  thrown errors. For authoring/CI: `explain(rows, { chartType, strict: true })` fails loudly
   *  on a bad encoding instead of returning a blank chart. Default false (production posture). */
  strict?: boolean;
}

/** Compact diagnostic from explain(): the inferred typing + resolved encoding, WITHOUT the render
 *  payload. Lets a dev assert the encoding in a unit test / CI against sample or live rows. */
export interface ChartExplanation {
  fields: { name: string; kind: FieldKind; role: FieldRole }[];
  chartType: ChartType;
  x: string;
  series: string[];
  /** Projection of `decisions`, kept for back-compatibility. */
  notes: string[];
  decisions: Decision[];
}

// --- DashboardSpec: a grid of items (charts, KPIs, text). A separate render-ready contract
// from ChartSpec; the widget discriminates on `items` (dashboard) vs `data` (single chart). ---

/** A single KPI tile: a headline number with optional signed delta and caption. */
export interface KpiTile {
  type: "kpi";
  /** Stable id for uniform addressability. v1 render_view item selection renders chart cells only. */
  id?: string;
  label: string;
  value: number | string | null;
  format?: FieldFormat;
  currency?: string;
  /** percent: value is a 0-1 fraction (renderer scales by 100). */
  fraction?: boolean;
  /** signed change vs prior period, same unit as value. */
  delta?: number;
  deltaFraction?: boolean;
  /** e.g. "vs last month". */
  caption?: string;
  span?: number;
  /** This tile failed to produce a value. Rendered as a failure, not an advisory. */
  error?: string;
}

/** A block of markdown text. The renderer parses it with raw HTML disabled; `heading` is escaped. */
export interface TextBlock {
  type: "text";
  /** Stable id for uniform addressability. v1 render_view item selection renders chart cells only. */
  id?: string;
  text: string;
  heading?: string;
  span?: number;
}

/** A dashboard cell holding one resolved chart. Presence of `spec` is the discriminant. */
export interface ChartCell {
  type?: "chart";
  /** Stable id for addressing this cell via render_view's item_id (re-render one chart alone). */
  id?: string;
  spec: ChartSpec;
  span?: number;
  /** This cell failed to build. Rendered as a failure, not an advisory. */
  error?: string;
}

export type DashboardItem = ChartCell | KpiTile | TextBlock;

/** Output contract for a multi-item dashboard. JSON-serializable; crosses to the widget. */
export interface DashboardSpec {
  title?: string;
  /** default 2; renderer clamps 1..4; item spans clamp to columns. */
  columns?: number;
  items: DashboardItem[];
  /** Projection of `decisions`, kept for back-compatibility. Same posture as ChartSpec.notes. */
  notes?: string[];
  /** Dashboard-level decisions, each addressed to the audiences it matters to. */
  decisions?: Decision[];
}
