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

/** The normalized result every data callback returns. */
export interface ChartData {
  rows: Record<string, unknown>[];
  fields?: FieldMeta[];
  encode?: Encode;
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
}

export interface ColumnSpec {
  key: string;
  label: string;
  format?: FieldFormat;
  granularity?: TimeGranularity;
  currency?: string;
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
  /** Non-fatal advisories about how the data was massaged (e.g. summed unaggregated rows). */
  notes?: string[];
}

/** Options to resolve(), typically sourced from the agent's tool args. */
export interface ResolveOptions {
  chartType?: ChartType | "auto";
  title?: string;
  stacking?: Stacking;
  horizontal?: boolean;
  /** Add reference lines: an average (computed) and/or a target (a value you pass). */
  reference?: { target?: number; average?: boolean };
}
