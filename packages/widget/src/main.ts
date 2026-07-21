// The chart widget. Runs inside the host's sandboxed iframe, speaks the MCP Apps bridge
// (ext-apps), receives the tool result (a ChartSpec in structuredContent), and renders it
// with ECharts (SVG renderer) for interactivity. Tables render as HTML.
import { App } from "@modelcontextprotocol/ext-apps";
import type { ChartSpec, DashboardSpec } from "@bonnard/mcp-charts";
import { echarts, themeName } from "./echarts-core.js";
import { specToOption } from "./spec-to-option.js";
import { renderTable, renderEmptyState } from "./table.js";
import { renderDashboardShell, renderChartNotes, isChartSpec, isDashboardSpec } from "./dashboard.js";
import { esc } from "./format.js";

const root = document.getElementById("root")!;

type EChartsInstance = ReturnType<typeof echarts.init>;
// A dashboard holds many charts; a single chart holds one. Track them uniformly so teardown
// disposes every ECharts instance and disconnects every observer.
let charts: EChartsInstance[] = [];
let observers: ResizeObserver[] = [];
let currentTheme: "light" | "dark" = "light";
let lastPayload: ChartSpec | DashboardSpec | null = null;

function teardown() {
  for (const o of observers) o.disconnect();
  observers = [];
  for (const c of charts) c.dispose();
  charts = [];
}

function paint(structured: unknown, fallbackText?: string) {
  // Dashboard first: it has `items` and no top-level `data`, so it must be checked before a chart.
  if (isDashboardSpec(structured)) {
    lastPayload = structured;
    renderDashboard(structured);
  } else if (isChartSpec(structured)) {
    lastPayload = structured;
    renderChart(structured);
  } else if (fallbackText) {
    teardown();
    root.innerHTML = `<pre class="fallback">${esc(fallbackText)}</pre>`;
  } else {
    teardown();
    root.innerHTML = `<div class="empty">Waiting for chart data…</div>`;
  }
}

// Mount one ECharts instance (with its own ResizeObserver) into a target element.
function mountChart(el: HTMLElement, spec: ChartSpec) {
  const c = echarts.init(el, themeName(currentTheme), { renderer: "svg" });
  c.setOption(specToOption(spec));
  charts.push(c);
  const ro = new ResizeObserver(() => c.resize());
  ro.observe(el);
  observers.push(ro);
}

function renderChart(spec: ChartSpec) {
  teardown();
  const title = spec.title ? `<div class="title">${esc(spec.title)}</div>` : "";
  // A 0-row result: show an explicit empty-state instead of an empty table or a blank plot.
  if (spec.data.length === 0) {
    root.innerHTML = `${title}${renderEmptyState()}${renderChartNotes(spec)}`;
    return;
  }
  // Tables are HTML, not a charting-library job.
  if (spec.chartType === "table") {
    root.innerHTML = `${renderTable(spec)}${renderChartNotes(spec)}`;
    return;
  }
  root.innerHTML = `${title}<div class="ec" id="ec"></div>${renderChartNotes(spec)}`;
  mountChart(document.getElementById("ec")!, spec);
}

function renderDashboard(spec: DashboardSpec) {
  teardown();
  root.innerHTML = renderDashboardShell(spec);
  spec.items.forEach((item, i) => {
    if (!("spec" in item)) return; // kpi/text cells are already final HTML
    const el = document.getElementById(`cell-${i}`);
    if (!el) return;
    if (item.spec.data.length === 0) {
      el.innerHTML = renderEmptyState();
      return;
    }
    if (item.spec.chartType === "table") {
      el.innerHTML = renderTable(item.spec);
      return;
    }
    el.innerHTML = `<div class="ec"></div>`;
    mountChart(el.firstElementChild as HTMLElement, item.spec);
  });
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
  if (theme === currentTheme && charts.length) return; // no-op if unchanged
  currentTheme = theme;
  document.documentElement.dataset.theme = currentTheme;
  // ECharts themes are set at init; re-render to repaint with the new palette.
  if (lastPayload) paint(lastPayload);
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

// Dev harness hook: gated on the `#harness` URL fragment so hosts never activate it (they load the
// resource without a fragment). Render-only — it just feeds a payload into paint(), which escapes
// all strings — so shipping it inert in the production bundle is safe.
if (location.hash === "#harness") {
  window.addEventListener("message", (e) => {
    const d = e.data as {
      type?: string;
      structuredContent?: unknown;
      text?: string;
      theme?: "light" | "dark";
    } | null;
    if (d?.type === "bonnard:harness-render") {
      if (d.theme === "light" || d.theme === "dark") applyTheme(d.theme);
      paint(d.structuredContent, d.text);
    }
  });
  // Tell the harness we're (re)loaded so it re-feeds the current payload — this is what turns a
  // Vite full-reload of this iframe (on a renderer source edit) into an HMR-like preview loop.
  parent.postMessage({ type: "bonnard:harness-ready" }, "*");
}

paint(undefined);
refreshTheme(); // resolves ChatGPT / OS theme immediately (before any MCP Apps handshake)
app
  .connect()
  .then(refreshTheme) // host context is available after connect (Cursor/Claude/Inspector)
  .catch((e) => {
    // Not running inside an MCP Apps host (e.g. ChatGPT or opened directly) — keep going.
    console.warn("MCP Apps host not detected:", e);
  });
