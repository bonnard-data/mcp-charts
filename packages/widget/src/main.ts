// The chart widget. Runs inside the host's sandboxed iframe, speaks the MCP Apps bridge
// (ext-apps), receives the tool result (a ChartSpec in structuredContent), and renders it
// with ECharts (SVG renderer) for interactivity. Tables render as HTML.
import { App } from "@modelcontextprotocol/ext-apps";
import type { ChartSpec } from "@bonnard/mcp-charts";
import { echarts, themeName } from "./echarts-core.js";
import { specToOption } from "./spec-to-option.js";
import { renderTable } from "./table.js";
import { esc } from "./format.js";

const root = document.getElementById("root")!;

type EChartsInstance = ReturnType<typeof echarts.init>;
let chart: EChartsInstance | null = null;
let resizeObserver: ResizeObserver | null = null;
let currentTheme: "light" | "dark" = "light";
let lastSpec: ChartSpec | null = null;

function isSpec(x: unknown): x is ChartSpec {
  return !!x && typeof x === "object" && Array.isArray((x as ChartSpec).data);
}

function teardown() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  chart?.dispose();
  chart = null;
}

function paint(structured: unknown, fallbackText?: string) {
  if (isSpec(structured)) {
    lastSpec = structured;
    renderChart(structured);
  } else if (fallbackText) {
    teardown();
    root.innerHTML = `<pre class="fallback">${esc(fallbackText)}</pre>`;
  } else {
    teardown();
    root.innerHTML = `<div class="empty">Waiting for chart data…</div>`;
  }
}

function renderChart(spec: ChartSpec) {
  teardown();
  // Tables are HTML, not a charting-library job.
  if (spec.chartType === "table") {
    root.innerHTML = renderTable(spec);
    return;
  }
  const title = spec.title ? `<div class="title">${esc(spec.title)}</div>` : "";
  root.innerHTML = `${title}<div class="ec" id="ec"></div>`;
  const el = document.getElementById("ec")!;
  chart = echarts.init(el, themeName(currentTheme), { renderer: "svg" });
  chart.setOption(specToOption(spec));
  resizeObserver = new ResizeObserver(() => chart?.resize());
  resizeObserver.observe(el);
}

// ChatGPT's Apps SDK exposes host state on a `window.openai` global (a different dialect from
// the MCP Apps host context). We read its theme too so dark mode follows ChatGPT.
declare global {
  interface Window {
    openai?: { theme?: "light" | "dark" };
  }
}

// Resolve the host theme across dialects: ChatGPT (window.openai) -> MCP Apps host context
// (Cursor/Claude/Inspector) -> the OS preference as a generic fallback.
function detectTheme(): "light" | "dark" {
  const oai = window.openai?.theme;
  if (oai === "light" || oai === "dark") return oai;
  const ctx = app.getHostContext()?.theme;
  if (ctx === "dark" || ctx === "light") return ctx;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: "light" | "dark") {
  if (theme === currentTheme && chart) return; // no-op if unchanged
  currentTheme = theme;
  document.documentElement.dataset.theme = currentTheme;
  // ECharts themes are set at init; re-init to repaint with the new palette.
  if (chart && lastSpec) renderChart(lastSpec);
}
const refreshTheme = () => applyTheme(detectTheme());

const app = new App({ name: "Bonnard Chart", version: "0.1.0" });

app.ontoolresult = (params) => {
  const text = params.content?.find((c) => c.type === "text")?.text;
  paint(params.structuredContent, text);
};
// Theme-change channels: MCP Apps host context, ChatGPT globals, and OS preference.
app.onhostcontextchanged = () => refreshTheme();
document.addEventListener("openai:set_globals", (e) => {
  if ((e as CustomEvent).detail?.globals?.theme) refreshTheme();
});
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", refreshTheme);

paint(undefined);
refreshTheme(); // resolves ChatGPT / OS theme immediately (before any MCP Apps handshake)
app
  .connect()
  .then(refreshTheme) // host context is available after connect (Cursor/Claude/Inspector)
  .catch((e) => {
    // Not running inside an MCP Apps host (e.g. ChatGPT or opened directly) — keep going.
    console.warn("MCP Apps host not detected:", e);
  });
