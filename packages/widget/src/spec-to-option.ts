// Maps a ChartSpec to an EChartsOption. Pure and serializable-data-in, so it runs identically in
// the iframe (interactive SVG) and in Node SSR (static SVG string).
// Tables are rendered separately (not a chart-library job) — see table.ts/renderTable.
import type { ChartSpec, FieldFormat } from "@bonnard/mcp-charts";
import type { ComposeOption } from "echarts/core";
import type {
  BarSeriesOption,
  LineSeriesOption,
  PieSeriesOption,
  ScatterSeriesOption,
  FunnelSeriesOption,
} from "echarts/charts";
import type { GridComponentOption, TooltipComponentOption, LegendComponentOption } from "echarts/components";
import { esc, fmt, fmtX } from "./format.js";

export type ECOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | ScatterSeriesOption
  | FunnelSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TipParam = any;

export function specToOption(spec: ChartSpec): ECOption {
  switch (spec.chartType) {
    case "pie":
      return pieOption(spec);
    case "scatter":
      return scatterOption(spec);
    case "funnel":
      return funnelOption(spec);
    case "waterfall":
      return waterfallOption(spec);
    case "line":
      return cartesianOption(spec, "line", false);
    case "area":
      return cartesianOption(spec, "line", true);
    default:
      return cartesianOption(spec, "bar", false);
  }
}

// Scatter / bubble: x and y are both values; an optional size column scales the symbol (bubble).
// Point data is packed as [x, y, size|null, label|null] so the tooltip/symbolSize can read by index.
function scatterOption(spec: ChartSpec): ECOption {
  const xFmt = (v: unknown) => fmt(v, spec.xAxis?.format, spec.xAxis?.currency, spec.xAxis?.fraction);
  const yFmt = (v: unknown) => fmt(v, spec.yAxis?.format, spec.yAxis?.currency, spec.yAxis?.fraction);
  const sizeKey = spec.size;
  const labelKey = spec.pointLabel;
  // One series per group when grouped by a category; each series reads its own (sparse) y column.
  const grouped = spec.series.length > 1;
  const yName = spec.yAxis?.label ?? (grouped ? "value" : (spec.series[0]?.label ?? "value"));
  // Global size max across every point so bubble scaling is consistent across groups.
  const sizes = sizeKey ? spec.data.map((r) => Number(r[sizeKey]) || 0) : [];
  const sMax = sizes.length ? Math.max(...sizes) : 0;

  const symbolSize = sizeKey ? (d: number[]) => 10 + (sMax ? (d[2]! / sMax) * 38 : 0) : 11;
  const points = (yKey: string) =>
    spec.data
      .filter((r) => r[yKey] != null && r[yKey] !== "")
      .map((r) => [
        Number(r[spec.x]),
        Number(r[yKey]),
        sizeKey ? Number(r[sizeKey]) || 0 : null,
        labelKey ? r[labelKey] : null,
      ]);

  return {
    grid: { left: 8, right: 24, top: 16, bottom: grouped ? 48 : 32, containLabel: true },
    ...(grouped && { legend: { bottom: 0, type: "scroll" as const } }),
    tooltip: {
      trigger: "item",
      formatter: (p: TipParam) => {
        const d = p.data as unknown[];
        const grp = grouped ? `${esc(p.seriesName)}<br/>` : "";
        const head = d[3] != null ? `${esc(d[3])}<br/>` : "";
        const sizeLine = sizeKey
          ? `<br/>${esc(spec.columns?.find((c) => c.key === sizeKey)?.label ?? sizeKey)}: ${fmt(d[2])}`
          : "";
        return `${grp}${head}${esc(spec.xAxis?.label ?? spec.x)}: ${xFmt(d[0])}<br/>${esc(yName)}: ${yFmt(d[1])}${sizeLine}`;
      },
    },
    xAxis: {
      type: "value",
      ...(spec.xAxis?.label && { name: spec.xAxis.label, nameLocation: "middle", nameGap: 26 }),
      axisLabel: { formatter: (v: number) => xFmt(v) },
      axisLine: { onZero: false },
      splitLine: { show: true },
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => yFmt(v) },
    },
    series: spec.series.map((s) => ({
      name: s.label,
      type: "scatter",
      symbolSize,
      itemStyle: { opacity: 0.8 },
      emphasis: { focus: "self" as const },
      data: points(s.key),
    })) as ECOption["series"],
  };
}

function cartesianOption(spec: ChartSpec, kind: "bar" | "line", area: boolean): ECOption {
  // Dual-axis (a right y-axis) disables stacking/horizontal — a bar+line combo is the goal.
  const dual = !!spec.yAxisRight;
  const stacked = !dual && (spec.stacking === "stacked" || spec.stacking === "stacked100");
  const pct = !dual && spec.stacking === "stacked100";
  const yfmt: FieldFormat | undefined = pct ? "percent" : spec.yAxis?.format;
  const cur = spec.yAxis?.currency;
  // stacked100 values are computed as 0-100 shares, so never fraction-scale them.
  const leftFmt = (v: unknown) => fmt(v, yfmt, cur, pct ? false : spec.yAxis?.fraction);
  const rightFmt = (v: unknown) => fmt(v, spec.yAxisRight?.format, spec.yAxisRight?.currency, spec.yAxisRight?.fraction);
  // Numeric x on a line/area -> a linear (value) axis with [x,y] point data, so irregular
  // spacing is honest. Bars stay categorical; stacking keeps the category path too.
  const numericX = kind === "line" && !stacked && !!spec.xAxis?.numeric;
  const cats = spec.data.map((r) => fmtX(r[spec.x], spec.xAxis?.granularity));
  const totals = spec.data.map((r) => spec.series.reduce((a, s) => a + (Number(r[s.key]) || 0), 0));

  const series = spec.series.map((s) => {
    const onRight = s.axis === "right";
    // right-axis series render as a line; same-axis series honor their own type (combo) else the base kind
    const seriesType = onRight ? "line" : (s.type ?? kind);
    const cells = spec.data.map((r) => r[s.key]);
    const data = pct
      ? cells.map((v, i) => {
          const n = Number(v) || 0;
          return { value: totals[i] ? +((n / totals[i]) * 100).toFixed(2) : 0, raw: n };
        })
      : numericX
        ? // [x, y] pairs on a linear x axis; null y stays a gap
          cells.map((v, i) => [Number(spec.data[i]![spec.x]), v == null ? null : Number(v) || 0])
        : // null cells stay null so non-stacked lines/bars show a gap, not a fake 0
          cells.map((v) => (v == null ? null : Number(v) || 0));
    return {
      name: s.label,
      type: seriesType,
      yAxisIndex: onRight ? 1 : 0,
      // Stack normally (incl. stacked area's line series), EXCEPT a same-axis combo line in a bar
      // chart — that line rides over the bars and must not be stacked.
      ...(stacked && !onRight && !(seriesType === "line" && kind === "bar") ? { stack: "total" } : {}),
      ...(seriesType === "line" ? { symbolSize: 6, showSymbol: spec.data.length <= 60 } : { barMaxWidth: 48 }),
      ...(area && seriesType === "line" && !onRight ? { areaStyle: { opacity: stacked ? 0.85 : 0.18 } } : {}),
      emphasis: { focus: "series" as const },
      // Per-series value formatting: each series formats against its own axis (left vs right).
      tooltip: { valueFormatter: onRight ? rightFmt : leftFmt },
      data,
    };
  });

  // xAxis/yAxis option types are nominally distinct in ECharts; build untyped + cast on assignment.
  const leftAxis: Record<string, unknown> = {
    type: "value",
    ...(pct ? { max: 100, axisLabel: { formatter: (v: number) => `${v}%` } } : { axisLabel: { formatter: leftFmt } }),
  };
  const rightAxis: Record<string, unknown> = {
    type: "value",
    axisLabel: { formatter: rightFmt },
    splitLine: { show: false }, // don't double up gridlines from both axes
  };
  const catAxis: Record<string, unknown> = {
    type: "category",
    data: cats,
    boundaryGap: kind === "bar",
    // Keep the category axis at the chart edge (not floating up to the zero line) so it never
    // cuts through bars when the data goes negative.
    axisLine: { onZero: false },
    // Drop colliding category labels rather than letting them overlap into mush.
    axisLabel: { hideOverlap: true },
  };
  const numericXAxis: Record<string, unknown> = {
    type: "value",
    axisLabel: { formatter: (v: number) => fmt(v, spec.xAxis?.format) },
    axisLine: { onZero: false },
  };

  const horizontal = !dual && !!spec.horizontal && kind === "bar";
  const yAxis = horizontal ? { ...catAxis, inverse: true } : dual ? [leftAxis, rightAxis] : leftAxis;

  // Reference lines (target / average): a dashed markLine on the value axis, drawn once via series[0].
  if (spec.reference?.length && series[0]) {
    const axisKey = horizontal ? "xAxis" : "yAxis";
    // Alternate each label between the two ends of its line so close reference values
    // (e.g. target vs average) don't overlap each other. Labels stay horizontal.
    const endTop = horizontal ? "end" : "insideEndTop";
    const startTop = horizontal ? "start" : "insideStartTop";
    (series[0] as Record<string, unknown>).markLine = {
      symbol: "none",
      lineStyle: { type: "dashed" },
      label: { rotate: 0, formatter: "{b}", fontSize: 11 },
      data: spec.reference.map((r, i) => ({
        [axisKey]: r.value,
        name: `${r.label}: ${leftFmt(r.value)}`,
        label: { position: i % 2 ? startTop : endTop },
      })),
    };
  }

  return {
    grid: { left: 8, right: dual ? 16 : 16, top: 16, bottom: spec.legend ? 28 : 8, containLabel: true },
    legend: spec.legend ? { bottom: 0, type: "scroll", icon: "roundRect" } : undefined,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: kind === "bar" ? "shadow" : "line" },
      // 100%-stacked needs a whole-tooltip formatter to show "share% (raw)"; everything else
      // uses the per-series valueFormatter set above.
      ...(pct
        ? {
            formatter: (params: TipParam) => {
              const arr = Array.isArray(params) ? params : [params];
              const head = esc(arr[0]?.axisValueLabel ?? "");
              const body = arr
                .map(
                  (p: TipParam) =>
                    `${p.marker}${esc(p.seriesName)}: ${fmt(p.data?.raw, spec.yAxis?.format, cur, spec.yAxis?.fraction)} (${p.value}%)`,
                )
                .join("<br/>");
              return `${head}<br/>${body}`;
            },
          }
        : {}),
    },
    xAxis: horizontal ? leftAxis : numericX ? numericXAxis : catAxis,
    yAxis: yAxis,
    series: series,
  };
}

// Funnel: ordered descending segments from a stage dimension + a value. Inline labels, % in tooltip.
function funnelOption(spec: ChartSpec): ECOption {
  const key = spec.series[0]?.key ?? "";
  const col = spec.columns?.find((c) => c.key === key);
  const vfmt = (v: unknown) => fmt(v, col?.format, col?.currency, col?.fraction);
  const data = spec.data.map((r) => ({ name: String(r[spec.x]), value: Number(r[key]) || 0 }));
  return {
    tooltip: {
      trigger: "item",
      formatter: (p: TipParam) => `${p.marker}${esc(p.name)}: ${vfmt(p.value)} (${p.percent}%)`,
    },
    series: [
      {
        type: "funnel",
        left: "6%",
        right: "6%",
        top: 10,
        bottom: 10,
        gap: 2,
        sort: "descending",
        // Floor the smallest segment so steep funnels (e.g. 24,800 -> 30) keep every stage visible
        // and labelable; the labels still carry the true values.
        minSize: "6%",
        maxSize: "100%",
        label: { show: true, position: "inside", formatter: "{b}  {c}" },
        labelLine: { show: false },
        emphasis: { label: { fontWeight: "bold" } },
        data,
      },
    ] as ECOption["series"],
  };
}

// Waterfall / bridge: a transparent base bar + a colored value bar (stacked) per step. Totals
// anchor at 0; deltas float from the running cumulative. Green up / red down / grey total.
function waterfallOption(spec: ChartSpec): ECOption {
  const key = spec.series[0]?.key ?? "";
  const col = spec.columns?.find((c) => c.key === key);
  const vf = (v: unknown) => fmt(v, col?.format, col?.currency, col?.fraction);
  const totals = new Set(spec.totals ?? []);
  const cats = spec.data.map((r) => String(r[spec.x]));
  const INCREASE = "#10b981",
    DECREASE = "#ef4444",
    TOTAL = "#6b7280";

  const base: number[] = [];
  const bars: { value: number; itemStyle: { color: string } }[] = [];
  let cum = 0;
  for (const r of spec.data) {
    const amt = Number(r[key]) || 0;
    if (totals.has(String(r[spec.x]))) {
      base.push(0);
      bars.push({ value: amt, itemStyle: { color: TOTAL } });
      cum = amt; // a total resets the running level
    } else if (amt >= 0) {
      base.push(cum);
      bars.push({ value: amt, itemStyle: { color: INCREASE } });
      cum += amt;
    } else {
      cum += amt;
      base.push(cum);
      bars.push({ value: -amt, itemStyle: { color: DECREASE } });
    }
  }

  return {
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "item",
      formatter: (p: TipParam) => {
        const r = spec.data[p.dataIndex as number];
        return `${esc(r?.[spec.x])}: ${vf(Number(r?.[key]))}`;
      },
    },
    xAxis: {
      type: "category",
      data: cats,
      axisLine: { onZero: false },
      axisLabel: { hideOverlap: true },
    },
    yAxis: { type: "value", axisLabel: { formatter: (v: number) => vf(v) } },
    series: [
      {
        type: "bar",
        stack: "wf",
        itemStyle: { color: "transparent" },
        emphasis: { disabled: true },
        silent: true,
        data: base,
      },
      {
        type: "bar",
        stack: "wf",
        barMaxWidth: 48,
        data: bars,
        label: {
          show: spec.data.length <= 12,
          position: "top",
          fontSize: 10,
          formatter: (p: TipParam) => vf(Number(spec.data[p.dataIndex as number]?.[key])),
        },
      },
    ] as ECOption["series"],
  };
}

function pieOption(spec: ChartSpec): ECOption {
  const key = spec.series[0]?.key ?? "";
  const cur = spec.yAxis?.currency;
  const yfmt = spec.yAxis?.format;
  const data = spec.data.map((r) => ({ name: String(r[spec.x]), value: Number(r[key]) || 0 }));
  return {
    legend: { bottom: 0, type: "scroll", icon: "roundRect" },
    tooltip: {
      trigger: "item",
      formatter: (p: TipParam) => `${p.marker}${esc(p.name)}: ${fmt(p.value, yfmt, cur, spec.yAxis?.fraction)} (${p.percent}%)`,
    },
    series: [
      {
        type: "pie",
        radius: ["45%", "70%"],
        center: ["50%", "46%"],
        minShowLabelAngle: 6,
        label: { formatter: "{b}: {d}%" },
        labelLine: { length: 8, length2: 8 },
        data,
      },
    ],
  };
}
