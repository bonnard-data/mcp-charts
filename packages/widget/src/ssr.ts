// Server-side render: ChartSpec -> standalone SVG string (no DOM). Powers snapshot tests,
// the visual PNG harness, and any static-image fallback. Tables fall through to HTML.
// Same adapter + themes as the iframe, so SSR output matches the interactive chart.
import type { ChartSpec } from "@bonnard/mcp-charts";
import { echarts, themeName } from "./echarts-core.js";
import { specToOption } from "./spec-to-option.js";
import { renderTable } from "./table.js";
import { esc } from "./format.js";

const W = 720;
const H = 360;

export interface SsrOptions {
  theme?: "light" | "dark";
  width?: number;
  height?: number;
}

export function renderToSvg(spec: ChartSpec, opts: SsrOptions = {}): string {
  // Tables aren't a charting-library job — reuse the HTML table renderer.
  if (spec.chartType === "table") return renderTable(spec);

  const title = spec.title ? `<div class="title">${esc(spec.title)}</div>` : "";
  const chart = echarts.init(null, themeName(opts.theme), {
    renderer: "svg",
    ssr: true,
    width: opts.width ?? W,
    height: opts.height ?? H,
  });
  chart.setOption({ animation: false, ...specToOption(spec) });
  const svg = chart.renderToSVGString();
  chart.dispose(); // SSR instances have no DOM to be GC'd with — release explicitly.
  return `${title}${svg}`;
}
