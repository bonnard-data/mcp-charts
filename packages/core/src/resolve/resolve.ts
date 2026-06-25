// resolve() — the pure brain. Turns a ChartData (rows + optional typing + encode) into a
// fully-specified, JSON-serializable ChartSpec: x / y / series, axis + column format
// descriptors, legend, pivoting, time-gap filling. No IO, no host, no chart library.
import type {
  AxisSpec,
  ChartData,
  ChartSpec,
  ColumnSpec,
  Encode,
  FieldMeta,
  ReferenceLine,
  ResolveOptions,
  SeriesSpec,
} from "../types.js";
import { inferFields } from "./infer.js";
import { detectChartType } from "./detect.js";
import { pivotData } from "./pivot.js";
import { fillMissingTimeIntervals } from "./fill-time.js";

const HORIZONTAL_CATEGORY_THRESHOLD = 8;
const MAX_PIE_SLICES = 8; // rank cap: slices beyond this fold into "Other"
const MIN_PIE_FRACTION = 0.02; // share cap: slices under 2% of the total fold into "Other"
const MAX_BARS = 30; // categorical bars beyond this: keep the top N by value, drop the tail
const MAX_SERIES = 12; // distinct series beyond this: keep the top N by total, fold rest into "Other"
const MAX_POINTS = 2000; // line/area points beyond this: stride-downsample to bound the payload

export function resolve(data: ChartData, opts: ResolveOptions = {}): ChartSpec {
  const encode = data.encode ?? {};
  const fields = inferFields(data);
  const byName = new Map(fields.map((f) => [f.name, f]));

  // Scatter/bubble: x AND y are measures, one row = one point. Skip the dimension/aggregate path
  // entirely (aggregating would collapse the cloud) — handled by its own branch below.
  const isScatter = opts.chartType === "scatter";

  // Numeric grouping column: when EVERY column is numeric (no time/string dimension to be an
  // x-axis), the lowest-cardinality numeric acts as the x dimension (e.g. {year, revenue} ->
  // a bar over year) instead of degrading to a two-measure table. Tie on cardinality -> the
  // earliest column (SQL convention puts the GROUP BY key first). Not for scatter (both stay measures).
  if (
    !isScatter &&
    !encode.x &&
    data.rows.length > 1 &&
    fields.length >= 2 &&
    fields.every((f) => f.role === "measure")
  ) {
    const distinct = (k: string) => new Set(data.rows.map((r) => r[k])).size;
    let best = fields[0]!;
    for (const f of fields) if (distinct(f.name) < distinct(best.name)) best = f;
    best.role = "dimension";
  }

  // Coerce measure columns to numbers (a backend may return numeric strings).
  const measureNames = new Set(fields.filter((f) => f.role === "measure").map((f) => f.name));
  let rows: Record<string, unknown>[] = data.rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const k of Object.keys(out)) {
      if (measureNames.has(k) && out[k] != null) {
        const n = Number(out[k]);
        if (!Number.isNaN(n)) out[k] = n;
      }
    }
    return out;
  });

  // Scatter/bubble: own branch — two measures as a point cloud, no aggregation/pivot/sort.
  if (isScatter) return resolveScatter(rows, fields, encode, opts);
  // Funnel: stages (a dimension) + a value, no axes — own branch.
  if (opts.chartType === "funnel") return resolveFunnel(rows, fields, encode, opts);
  // Waterfall: ordered steps with signed deltas; first/last (or a marked column) are totals.
  if (opts.chartType === "waterfall") return resolveWaterfall(rows, fields, encode, opts);

  // --- x-axis: encode wins, then first time field, then first dimension ---
  const timeField = fields.find((f) => f.role === "time");
  const dimField = fields.find((f) => f.role === "dimension");
  const xField: FieldMeta | undefined = encode.x ? byName.get(encode.x) : (timeField ?? dimField);
  const x = xField?.name ?? "";

  // --- measures (y) --- (never plot the x column as a measure)
  // y2 = measures pulled onto a secondary right axis (dual-axis combo); excluded from the left.
  const y2Names = encode.y2 ? (Array.isArray(encode.y2) ? encode.y2 : [encode.y2]) : [];
  const yNames = (
    encode.y
      ? Array.isArray(encode.y)
        ? encode.y
        : [encode.y]
      : fields.filter((f) => f.role === "measure" && f.name !== x).map((f) => f.name)
  ).filter((n) => !y2Names.includes(n));

  let chartType = !opts.chartType || opts.chartType === "auto" ? detectChartType(fields) : opts.chartType;

  // No x-axis to plot against -> fall back to a table.
  if (!x && chartType !== "table") chartType = "table";

  // Tables are a RAW grid passthrough: every column, every row, in source order.
  // No pivot, no series selection, no time-fill — those are chart concerns and would
  // silently drop the text columns a table is meant to show.
  if (chartType === "table") {
    return {
      chartType: "table",
      data: rows,
      x: "",
      series: [],
      legend: false,
      ...(opts.title && { title: opts.title }),
      columns: fields.map((f) => ({
        key: f.name,
        label: f.label ?? f.name,
        ...(f.format && { format: f.format }),
        ...(f.currency && { currency: f.currency }),
        ...(f.granularity && { granularity: f.granularity }),
      })),
    };
  }

  // Normalize x values (nulls, booleans) for plotting.
  if (x) {
    const isBool = xField?.kind === "boolean";
    let allEmpty = rows.length > 0;
    for (const row of rows) {
      const v = row[x];
      if (v == null || v === "") row[x] = "(No value)";
      else {
        allEmpty = false;
        if (isBool) row[x] = v === true || v === "true" ? "Yes" : "No";
      }
    }
    // An entirely-null x column is a broken query (no axis to plot against), not a one-bar chart.
    if (allEmpty) throw new Error(`Column "${x}" is entirely empty — nothing to put on the x-axis.`);
  }

  // --- series: pivot a (time + one categorical dimension + one measure) into multi-series ---
  const pivotDim =
    encode.series ??
    (timeField && dimField && dimField.name !== x && dimField.kind === "string" ? dimField.name : undefined);

  const notes: string[] = [];
  let series: SeriesSpec[];
  let yAxisRight: AxisSpec | undefined;
  if (pivotDim && yNames.length === 1) {
    const result = pivotData(rows, x, pivotDim, yNames[0]!);
    rows = result.data;
    series = result.seriesKeys.map((key) => ({ key, label: key }));
    if (result.collapsed > 0)
      notes.push(
        `Summed ${result.collapsed} row(s) that shared the same ${x} + ${pivotDim} — the data looked unaggregated.`,
      );
    // Too many series = an indistinguishable color soup. Keep the largest by total, fold the
    // rest into one "Other" series (stacking is part-to-whole, so the total must be preserved).
    if (series.length > MAX_SERIES) {
      const grand = (key: string) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
      const drop = [...series].sort((a, b) => grand(b.key) - grand(a.key)).slice(MAX_SERIES - 1);
      const dropKeys = new Set(drop.map((s) => s.key));
      for (const r of rows) {
        let other = 0;
        for (const k of dropKeys) {
          other += Number(r[k]) || 0;
          delete r[k];
        }
        r.Other = other;
      }
      series = [...series.filter((s) => !dropKeys.has(s.key)), { key: "Other", label: "Other" }];
      notes.push(`Grouped ${drop.length} smaller series into "Other".`);
    }
  } else {
    // Left-axis series + (optional) right-axis series for a dual-axis combo.
    // encode.line names left-axis measures to draw as a line instead of bars (same-axis combo).
    const lineNames = encode.line ? (Array.isArray(encode.line) ? encode.line : [encode.line]) : [];
    series = yNames.map((key) => ({
      key,
      label: byName.get(key)?.label ?? key,
      ...(lineNames.includes(key) && { type: "line" as const }),
    }));
    for (const key of y2Names) series.push({ key, label: byName.get(key)?.label ?? key, axis: "right" });
    if (y2Names.length > 0) {
      const f = byName.get(y2Names[0]!);
      yAxisRight = {
        ...(f?.label && { label: f.label }),
        ...(f?.format && { format: f.format }),
        ...(f?.currency && { currency: f.currency }),
      };
    }
    // Sum duplicate x rows: unaggregated SQL (no GROUP BY) yields repeated categories that
    // would otherwise render as overlapping/duplicate bars instead of one summed value.
    if (x && series.length > 0) {
      const agg = aggregateByX(
        rows,
        x,
        series.map((s) => s.key),
      );
      rows = agg.rows;
      if (agg.collapsed > 0)
        notes.push(`Summed ${agg.collapsed} row(s) that shared the same ${x} — the data looked unaggregated.`);
    }
  }

  // Sort a time / numeric x ascending. Agent SQL often omits ORDER BY, which makes lines
  // zig-zag and numeric bars appear out of order. Category (string) x keeps source order.
  if (x && chartType !== "pie") rows = sortRowsByX(rows, x, xField);

  // Fill time gaps so lines/areas render breaks correctly.
  if (xField?.role === "time" && xField.granularity && x) {
    rows = fillMissingTimeIntervals(
      rows,
      x,
      series.map((s) => s.key),
      xField.granularity,
    );
  }

  // Too many categorical bars are unreadable. Keep the top N by value (a bar chart is a ranking,
  // so "top N" is the honest reduction) and drop the tail — no "Other" bar, which would mislead
  // when the tail is large. Continuous line/area is left alone (dense series are legitimate).
  if (chartType === "bar" && series.length > 0 && rows.length > MAX_BARS) {
    const origLen = rows.length;
    const total = (r: Record<string, unknown>) => series.reduce((a, s) => a + (Number(r[s.key]) || 0), 0);
    const keep = new Set([...rows].sort((a, b) => total(b) - total(a)).slice(0, MAX_BARS));
    rows = rows.filter((r) => keep.has(r));
    notes.push(`Showing the top ${rows.length} of ${origLen} categories by value.`);
  }

  // Very dense line/area: stride-downsample to bound the payload (keep every Nth point + the
  // last, preserving range and shape). Lines tolerate many points, so the threshold is high.
  if ((chartType === "line" || chartType === "area") && rows.length > MAX_POINTS) {
    const origLen = rows.length;
    const step = Math.ceil(origLen / MAX_POINTS);
    const sampled = rows.filter((_, i) => i % step === 0);
    if (sampled[sampled.length - 1] !== rows[origLen - 1]) sampled.push(rows[origLen - 1]!);
    rows = sampled;
    notes.push(`Downsampled ${origLen} points to ${rows.length} for display.`);
  }

  // Stacked modes: zero-fill missing (x, series) cells so stacks stay aligned (a missing cell
  // is "0 contribution", not a hole that shifts the bars above it). Non-stacked keeps the gap.
  if ((opts.stacking === "stacked" || opts.stacking === "stacked100") && series.length > 0) {
    for (const row of rows) for (const s of series) if (row[s.key] == null) row[s.key] = 0;
  }

  // Pie: drop non-positive slices, order largest-first, and fold a long tail into "Other".
  // A slice is "small" if it ranks beyond MAX_PIE_SLICES OR is under MIN_PIE_FRACTION of the
  // total (this is what catches the sub-1% slivers that make a pie unreadable). Only fold when
  // it collapses >1 slice — a lone small slice is left alone.
  if (chartType === "pie" && series.length > 0) {
    const k = series[0]!.key;
    // All values zero/negative: plot magnitudes of the negatives so the pie isn't blank.
    if (!rows.some((r) => Number(r[k]) > 0)) {
      const neg = rows.filter((r) => r[k] != null && Number(r[k]) < 0);
      rows = neg.map((r) => ({ ...r, [k]: Math.abs(Number(r[k])) }));
      if (rows.length > 0) notes.push("All values were negative — showing their magnitudes.");
    } else {
      rows = rows.filter((r) => r[k] != null && Number(r[k]) > 0);
    }
    rows = rows.sort((a, b) => (Number(b[k]) || 0) - (Number(a[k]) || 0));
    const total = rows.reduce((sum, r) => sum + (Number(r[k]) || 0), 0);
    const isSmall = (r: Record<string, unknown>, i: number) =>
      i >= MAX_PIE_SLICES - 1 || (total > 0 && (Number(r[k]) || 0) / total < MIN_PIE_FRACTION);
    const small = rows.filter(isSmall);
    if (small.length > 1) {
      const kept = rows.filter((r, i) => !isSmall(r, i));
      const other = small.reduce((sum, r) => sum + (Number(r[k]) || 0), 0);
      rows = [...kept, { [x]: "Other", [k]: other }];
      notes.push(`Grouped ${small.length} small slices into "Other".`);
    }
  }

  // Axis format descriptors (the spec declares formatting; the widget applies it at render time).
  const firstMeasure = byName.get(yNames[0] ?? "");
  const yAxis = {
    ...(series.length === 1 && { label: series[0]!.label }),
    ...(firstMeasure?.format && { format: firstMeasure.format }),
    ...(firstMeasure?.currency && { currency: firstMeasure.currency }),
  };
  const xAxis = {
    ...(xField && { label: xField.label }),
    ...(xField?.granularity && { granularity: xField.granularity }),
    // Numeric (non-time) x: signal the renderer to use a linear scale on line/area, so points
    // sit at their true positions (irregular gaps show) instead of evenly-spaced categories.
    ...(xField?.kind === "number" && { numeric: true }),
  };

  // Orientation follows the x TYPE, not a raw count. Only CATEGORICAL bars flip horizontal (for
  // readable labels when there are many). Time/numeric x stay vertical: time reads left->right and a
  // numeric axis is linear — flipping them is wrong (and was the bug that sent month series sideways).
  const hasComboLine = series.some((s) => s.type === "line");
  let horizontal = opts.horizontal;
  if (
    horizontal == null &&
    chartType === "bar" &&
    xField?.kind === "string" &&
    rows.length > HORIZONTAL_CATEGORY_THRESHOLD
  ) {
    horizontal = true;
  }
  // A same-axis combo line is only meaningful over vertical bars (a connected line on a horizontal
  // layout becomes a meaningless diagonal), so never render a combo horizontal — even if asked.
  if (hasComboLine) horizontal = false;

  const columns = buildColumns(x, xField, series, byName);

  // Reference lines: an average computed from the primary (left) series, and/or a target value.
  const reference: ReferenceLine[] = [];
  if (opts.reference) {
    const primary = series.find((s) => s.axis !== "right") ?? series[0];
    if (opts.reference.average && primary) {
      const vals = rows.map((r) => Number(r[primary.key])).filter((v) => Number.isFinite(v));
      if (vals.length)
        reference.push({
          value: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100,
          label: "Avg",
        });
    }
    if (opts.reference.target != null) reference.push({ value: opts.reference.target, label: "Target" });
  }

  return {
    chartType,
    data: rows,
    x,
    series,
    ...(reference.length > 0 && { reference }),
    ...(Object.keys(xAxis).length > 0 && { xAxis }),
    ...(Object.keys(yAxis).length > 0 && { yAxis }),
    ...(yAxisRight && Object.keys(yAxisRight).length > 0 && { yAxisRight }),
    legend: series.length > 1,
    ...(opts.stacking && { stacking: opts.stacking }),
    ...(horizontal != null && { horizontal }),
    ...(opts.title && { title: opts.title }),
    columns,
    ...(notes.length > 0 && { notes }),
  };
}

// Scatter/bubble: x and y are measures (one row = one point). No aggregation, pivot, or sort — that
// would destroy the cloud. Optional size (3rd measure) = bubble; first dimension = the point label.
function resolveScatter(
  rows: Record<string, unknown>[],
  fields: FieldMeta[],
  encode: Encode,
  opts: ResolveOptions,
): ChartSpec {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const measures = fields.filter((f) => f.role === "measure");
  const yEnc = Array.isArray(encode.y) ? encode.y[0] : encode.y;
  const x = encode.x ?? measures[0]?.name;
  const y = yEnc ?? measures.find((m) => m.name !== x)?.name;
  if (!x || !y) {
    throw new Error(
      "A scatter chart needs two numeric columns. Select at least two measures (x and y), e.g. orders and revenue.",
    );
  }
  const xField = byName.get(x);
  const yField = byName.get(y);
  const isNum = (f?: FieldMeta) => f?.kind === "number";
  if (!isNum(xField) || !isNum(yField)) {
    throw new Error(`A scatter chart needs numeric x and y; "${x}" or "${y}" is not numeric.`);
  }
  const size = encode.size && byName.get(encode.size)?.kind === "number" ? encode.size : undefined;
  const pointLabel = fields.find((f) => f.role === "dimension")?.name;

  const colMeta = (k: string) => {
    const f = byName.get(k);
    return {
      key: k,
      label: f?.label ?? k,
      ...(f?.format && { format: f.format }),
      ...(f?.currency && { currency: f.currency }),
    };
  };
  const columns = [x, y, ...(size ? [size] : []), ...(pointLabel ? [pointLabel] : [])].map(colMeta);

  return {
    chartType: "scatter",
    data: rows,
    x,
    series: [{ key: y, label: yField?.label ?? y }],
    ...(size && { size }),
    ...(pointLabel && { pointLabel }),
    xAxis: {
      ...(xField?.label && { label: xField.label }),
      ...(xField?.format && { format: xField.format }),
      ...(xField?.currency && { currency: xField.currency }),
      numeric: true,
    },
    yAxis: {
      ...(yField?.label && { label: yField.label }),
      ...(yField?.format && { format: yField.format }),
      ...(yField?.currency && { currency: yField.currency }),
    },
    legend: false,
    ...(opts.title && { title: opts.title }),
    columns,
  };
}

// Funnel: a stage dimension + a value, drawn as ordered descending segments. No axes, no pivot.
function resolveFunnel(
  rows: Record<string, unknown>[],
  fields: FieldMeta[],
  encode: Encode,
  opts: ResolveOptions,
): ChartSpec {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const dim = encode.x ?? fields.find((f) => f.role === "dimension")?.name;
  const yEnc = Array.isArray(encode.y) ? encode.y[0] : encode.y;
  const value = yEnc ?? fields.find((f) => f.role === "measure")?.name;
  if (!dim || !value) {
    throw new Error("A funnel chart needs a stage/label column and a numeric value column (e.g. stage + count).");
  }
  const valField = byName.get(value);
  // A funnel segment must be positive; drop non-positive stages (but never end up empty).
  const positive = rows.filter((r) => (Number(r[value]) || 0) > 0);
  const data = positive.length > 0 ? positive : rows;
  const colMeta = (k: string) => {
    const f = byName.get(k);
    return {
      key: k,
      label: f?.label ?? k,
      ...(f?.format && { format: f.format }),
      ...(f?.currency && { currency: f.currency }),
    };
  };
  return {
    chartType: "funnel",
    data,
    x: dim,
    series: [{ key: value, label: valField?.label ?? value }],
    legend: false,
    ...(opts.title && { title: opts.title }),
    columns: [dim, value].map(colMeta),
  };
}

// Waterfall / bridge: ordered steps whose value is a SIGNED delta (+ gain, − loss). Start/end
// "totals" anchor from 0; the renderer computes the running cumulative + offsets. Totals are taken
// from a marker column (values like total/opening/closing) if present, else the first & last rows.
const TOTAL_RE = /^\s*(total|subtotal|opening|closing|start|end|net|balance)\b/i;
function resolveWaterfall(
  rows: Record<string, unknown>[],
  fields: FieldMeta[],
  encode: Encode,
  opts: ResolveOptions,
): ChartSpec {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const dim = encode.x ?? fields.find((f) => f.role === "dimension")?.name;
  const value =
    (Array.isArray(encode.y) ? encode.y[0] : encode.y) ??
    fields.find((f) => f.role === "measure" && f.name !== dim)?.name;
  if (!dim || !value) {
    throw new Error(
      "A waterfall needs a step label and a numeric value. The value should be the SIGNED change at each step (e.g. -240000 for a loss); mark the start/end rows as totals.",
    );
  }
  if (rows.length < 2) {
    throw new Error("A waterfall needs at least a start total and one change step.");
  }
  // Totals: a marker column (e.g. kind/type/direction = total/opening/closing) if one exists,
  // otherwise the conventional first and last rows.
  const markerCol = fields.find(
    (f) =>
      f.name !== dim &&
      f.name !== value &&
      f.role === "dimension" &&
      rows.some((r) => TOTAL_RE.test(String(r[f.name]))),
  );
  const totals = markerCol
    ? rows.filter((r) => TOTAL_RE.test(String(r[markerCol.name]))).map((r) => String(r[dim]))
    : [String(rows[0]![dim]), String(rows[rows.length - 1]![dim])];

  const valField = byName.get(value);
  const colMeta = (k: string) => {
    const f = byName.get(k);
    return {
      key: k,
      label: f?.label ?? k,
      ...(f?.format && { format: f.format }),
      ...(f?.currency && { currency: f.currency }),
    };
  };
  return {
    chartType: "waterfall",
    data: rows,
    x: dim,
    series: [{ key: value, label: valField?.label ?? value }],
    ...(totals.length > 0 && { totals: [...new Set(totals)] }),
    yAxis: {
      ...(valField?.label && { label: valField.label }),
      ...(valField?.format && { format: valField.format }),
      ...(valField?.currency && { currency: valField.currency }),
    },
    legend: false,
    ...(opts.title && { title: opts.title }),
    columns: [dim, value].map(colMeta),
  };
}

// Sort rows by x ascending for time / numeric axes (chronological / numeric order). String
// categories are left in source order, which respects an explicit ORDER BY in the query.
function sortRowsByX(
  rows: Record<string, unknown>[],
  xKey: string,
  xField: FieldMeta | undefined,
): Record<string, unknown>[] {
  if (xField?.role === "time") {
    const t = (v: unknown) => {
      let s = String(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += "T00:00:00.000Z";
      else if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !/[Z+-]\d{0,2}:?\d{0,2}$/.test(s.slice(10))) s += "Z";
      const ms = new Date(s).getTime();
      return Number.isNaN(ms) ? Infinity : ms; // unparseable dates sort to the end
    };
    return [...rows].sort((a, b) => t(a[xKey]) - t(b[xKey]));
  }
  if (xField?.kind === "number") {
    return [...rows].sort((a, b) => (Number(a[xKey]) || 0) - (Number(b[xKey]) || 0));
  }
  return rows;
}

// Group rows by x and sum measure columns, folding unaggregated duplicates into one row per x.
// `collapsed` = how many extra rows were merged (0 when the data was already aggregated).
function aggregateByX(
  rows: Record<string, unknown>[],
  xKey: string,
  measureKeys: string[],
): { rows: Record<string, unknown>[]; collapsed: number } {
  const groups = new Map<string, Record<string, unknown>>();
  let collapsed = 0;
  for (const row of rows) {
    const key = String(row[xKey]);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...row });
    } else {
      collapsed++;
      for (const m of measureKeys) {
        existing[m] = (Number(existing[m]) || 0) + (Number(row[m]) || 0);
      }
    }
  }
  return { rows: Array.from(groups.values()), collapsed };
}

function buildColumns(
  x: string,
  xField: FieldMeta | undefined,
  series: SeriesSpec[],
  byName: Map<string, FieldMeta>,
): ColumnSpec[] {
  const cols: ColumnSpec[] = [];
  if (x) {
    cols.push({
      key: x,
      label: xField?.label ?? x,
      ...(xField?.granularity && { granularity: xField.granularity }),
    });
  }
  for (const s of series) {
    const f = byName.get(s.key);
    cols.push({
      key: s.key,
      label: s.label,
      ...(f?.format && { format: f.format }),
      ...(f?.currency && { currency: f.currency }),
    });
  }
  return cols;
}
