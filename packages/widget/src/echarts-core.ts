// Tree-shaken ECharts core: register ONLY what we ship (bar/line/pie + SVG renderer) and the
// two house themes. Shared by the in-iframe client renderer and the Node SSR path, so the bundle
// stays minimal (no CanvasRenderer, no unused chart types). Import this, not the `echarts` barrel.
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, ScatterChart, FunnelChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, MarkLineComponent } from "echarts/components";
import { LabelLayout, LegacyGridContainLabel } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";

// LegacyGridContainLabel keeps `grid.containLabel` working in v6 (now opt-in) so axis labels
// never clip regardless of their width. MarkLineComponent powers reference lines (target/average).
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  FunnelChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  LabelLayout,
  LegacyGridContainLabel,
  SVGRenderer,
]);

// Matches the widget CSS tokens in index.html so charts sit seamlessly on the host surface.
const PALETTE = ["#5b5bd6", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

function theme(fg: string, muted: string, grid: string) {
  const axis = {
    axisLine: { lineStyle: { color: grid } },
    axisTick: { show: false },
    axisLabel: { color: muted },
    splitLine: { lineStyle: { color: grid } },
  };
  return {
    color: PALETTE,
    backgroundColor: "transparent",
    textStyle: { color: fg, fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
    title: { textStyle: { color: fg } },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: axis,
    legend: { textStyle: { color: muted } },
    tooltip: {
      backgroundColor: fg === "#1a1a1a" ? "#ffffff" : "#1f1f1f",
      borderColor: grid,
      textStyle: { color: fg === "#1a1a1a" ? "#1a1a1a" : "#fafafa" },
    },
  };
}

// Token values mirror index.html :root / [data-theme="dark"].
echarts.registerTheme("bonnard-light", theme("#1a1a1a", "#6b7280", "#e5e7eb"));
echarts.registerTheme("bonnard-dark", theme("#fafafa", "#9ca3af", "#2a2a2a"));

export const themeName = (theme?: string) => (theme === "dark" ? "bonnard-dark" : "bonnard-light");

export { echarts, PALETTE };
