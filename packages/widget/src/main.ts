// The chart widget. Runs inside the host's sandboxed iframe, speaks the MCP Apps bridge
// (ext-apps), receives the tool result (a ChartSpec in structuredContent), and renders it
// with ECharts (SVG renderer) for interactivity. Tables render as HTML.
import { App } from "@modelcontextprotocol/ext-apps";
import type { ChartSpec, DashboardItem, DashboardSpec } from "@bonnard/mcp-charts";
import { echarts, themeName } from "./echarts-core.js";
import { specToOption } from "./spec-to-option.js";
import { renderTable, renderEmptyState } from "./table.js";
import {
  renderDashboardShell,
  renderSingleItem,
  renderChartNotes,
  isChartSpec,
  isDashboardSpec,
  isDashboardItem,
} from "./dashboard.js";
import { esc } from "./format.js";
import {
  EMBED_PROTOCOL_VERSION,
  SizeReporter,
  applyTokens,
  parseEmbedFragment,
  sanitizeTokens,
  type EmbedConfig,
} from "./embed.js";

const root = document.getElementById("root")!;

type EChartsInstance = ReturnType<typeof echarts.init>;
type Payload = ChartSpec | DashboardSpec | DashboardItem;
// A dashboard holds many charts; a single chart holds one. Track them uniformly so teardown
// disposes every ECharts instance and disconnects every observer.
let charts: EChartsInstance[] = [];
let observers: ResizeObserver[] = [];
let currentTheme: "light" | "dark" = "light";
let lastPayload: Payload | null = null;
let lastItem: number | undefined;

// Embed mode is decided by the fragment before the first paint, so the host-surface CSS never flashes.
const embed: EmbedConfig | null = parseEmbedFragment(location.hash);
if (embed) {
  document.documentElement.dataset.embed = "";
  if (embed.theme) currentTheme = embed.theme;
}
const sizeReporter = embed ? new SizeReporter(root, (m) => parent.postMessage(m, "*")) : null;

function teardown() {
  for (const o of observers) o.disconnect();
  observers = [];
  for (const c of charts) c.dispose();
  charts = [];
}

// `item` selects one cell of a DashboardSpec (Grafana d-solo style); ignored for other payloads.
function paint(structured: unknown, fallbackText?: string, item?: number) {
  // Dashboard first: it has `items` and no top-level `data`, so it must be checked before a chart.
  if (isDashboardSpec(structured)) {
    lastPayload = structured;
    lastItem = item;
    const selected = item == null ? undefined : structured.items[item];
    if (selected) renderItemOnly(selected);
    else renderDashboard(structured);
  } else if (isChartSpec(structured)) {
    lastPayload = structured;
    lastItem = undefined;
    renderChart(structured);
  } else if (embed && isDashboardItem(structured)) {
    lastPayload = structured;
    lastItem = undefined;
    renderItemOnly(structured);
  } else if (fallbackText) {
    teardown();
    lastPayload = null;
    root.innerHTML = `<pre class="fallback">${esc(fallbackText)}</pre>`;
  } else {
    teardown();
    lastPayload = null;
    root.innerHTML = `<div class="empty">Waiting for chart data…</div>`;
  }
  sizeReporter?.schedule();
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

// Embed mode suppresses the widget's own title and (opt-out) the guardrail notes.
const showTitle = () => !embed || embed.titled;
const showNotes = () => !embed || embed.notes;
const notesFor = (spec: ChartSpec) => (showNotes() ? renderChartNotes(spec) : "");

function renderChart(spec: ChartSpec) {
  teardown();
  const title = spec.title && showTitle() ? `<div class="title">${esc(spec.title)}</div>` : "";
  // A 0-row result: show an explicit empty-state instead of an empty table or a blank plot.
  if (spec.data.length === 0) {
    root.innerHTML = `${title}${renderEmptyState()}${notesFor(spec)}`;
    return;
  }
  // Tables are HTML, not a charting-library job.
  if (spec.chartType === "table") {
    root.innerHTML = `${renderTable(spec)}${notesFor(spec)}`;
    return;
  }
  root.innerHTML = `${title}<div class="ec" id="ec"></div>${notesFor(spec)}`;
  mountChart(document.getElementById("ec")!, spec);
}

// Paint a chart cell's mount point: empty state, table, or an ECharts instance.
function paintCell(el: HTMLElement, spec: ChartSpec) {
  if (spec.data.length === 0) {
    el.innerHTML = renderEmptyState();
    return;
  }
  if (spec.chartType === "table") {
    el.innerHTML = renderTable(spec);
    return;
  }
  el.innerHTML = `<div class="ec"></div>`;
  mountChart(el.firstElementChild as HTMLElement, spec);
}

function renderDashboard(spec: DashboardSpec) {
  teardown();
  root.innerHTML = renderDashboardShell(spec, { titled: showTitle(), notes: showNotes() });
  spec.items.forEach((item, i) => {
    if (!("spec" in item)) return; // kpi/text cells are already final HTML
    const el = document.getElementById(`cell-${i}`);
    if (el) paintCell(el, item.spec);
  });
}

// One cell, no `.cell` chrome. Embed mode's core render: a bare DashboardItem, or items[item].
function renderItemOnly(item: DashboardItem) {
  teardown();
  root.innerHTML = renderSingleItem(item, { notes: showNotes() });
  if (!("spec" in item)) return;
  const el = document.getElementById("cell-0");
  if (el) paintCell(el, item.spec);
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
  // An embed consumer's declared theme is authoritative: the host dialects below describe the MCP
  // host's chrome, which is not the surface an embedded cell lives in.
  if (embed?.theme) return embed.theme;
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
  if (lastPayload) paint(lastPayload, undefined, lastItem);
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

// The parent-driven render channel, gated on the URL fragment so hosts never activate it (they load
// the resource without one). Two dialects share this listener: `bonnard:render` is the public embed
// API, `bonnard:harness-render` the internal dev harness. Render-only — every payload goes through
// paint(), which escapes all strings — so shipping it inert in the production bundle is safe.
const isHarness = location.hash === "#harness";
if (embed || isHarness) {
  window.addEventListener("message", (e) => {
    const d = e.data as {
      type?: string;
      payload?: unknown;
      structuredContent?: unknown;
      text?: string;
      item?: number;
      theme?: "light" | "dark";
      tokens?: unknown;
    } | null;
    const isRender = d?.type === "bonnard:render";
    if (!isRender && d?.type !== "bonnard:harness-render") return;
    if (d.theme === "light" || d.theme === "dark") applyTheme(d.theme);
    if (embed && "tokens" in d) applyTokens(document.documentElement, sanitizeTokens(d.tokens));
    // `payload` is the public field; `structuredContent` is the harness (and MCP tool-result) name.
    const payload = isRender && "payload" in d ? d.payload : d.structuredContent;
    const item = typeof d.item === "number" && Number.isInteger(d.item) && d.item >= 0 ? d.item : undefined;
    paint(payload, d.text, item);
  });
  // Tell the parent we're (re)loaded so it re-feeds the current payload. For the harness this is
  // what turns a Vite full-reload of the iframe into an HMR-like preview loop; for an embed it is
  // the handshake a consumer waits on before its first `bonnard:render`.
  if (embed) parent.postMessage({ type: "bonnard:ready", protocolVersion: EMBED_PROTOCOL_VERSION }, "*");
  if (isHarness) parent.postMessage({ type: "bonnard:harness-ready" }, "*");
}

paint(undefined);
refreshTheme(); // resolves ChatGPT / OS theme immediately (before any MCP Apps handshake)
// Content-height reporting starts with the first paint and runs for the frame's lifetime: fonts and
// text wrapping settle after paint, so ResizeObserver is the only reliable trigger.
sizeReporter?.start();
app
  .connect()
  .then(refreshTheme) // host context is available after connect (Cursor/Claude/Inspector)
  .catch((e) => {
    // Not running inside an MCP Apps host (e.g. ChatGPT or opened directly) — keep going.
    console.warn("MCP Apps host not detected:", e);
  });
