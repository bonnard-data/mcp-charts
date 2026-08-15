// The chart widget. Runs inside the host's sandboxed iframe, speaks the MCP Apps bridge
// (ext-apps), receives the tool result (a ChartSpec in structuredContent), and renders it
// with ECharts (SVG renderer) for interactivity. Tables render as HTML.
//
// Embed mode (`#embed`) is a separate, self-contained surface: it never constructs the MCP Apps
// bridge, so nothing it does can be sequenced behind a handshake that an ordinary parent will
// never answer.
import { App } from "@modelcontextprotocol/ext-apps";
import type { ChartSpec, DashboardItem, DashboardSpec, DecisionAudience } from "@bonnard/mcp-charts";
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
  type EmbedSizing,
} from "./embed.js";
import { selectItem, validatePayload, type BonnardErrorCode, type BonnardWidgetMessage } from "./embed-protocol.js";
import { ALL_AUDIENCES, isAudience } from "./decisions.js";

const root = document.getElementById("root")!;

type EChartsInstance = ReturnType<typeof echarts.init>;
type Payload = ChartSpec | DashboardSpec | DashboardItem;
// A dashboard holds many charts; a single chart holds one. Track them uniformly so teardown
// disposes every ECharts instance and disconnects every observer.
let charts: EChartsInstance[] = [];
let observers: ResizeObserver[] = [];
let currentTheme: "light" | "dark" = "light";
let lastPayload: Payload | null = null;
let lastItem: DashboardItem | undefined;
// Theme precedence: an explicit theme from a render message outranks the fragment, which outranks
// the host/OS. Once a message sets a theme it persists, so a later host refresh cannot revert it.
let messageTheme: "light" | "dark" | undefined;
// The dev harness's audience filter, so flipping viewer/author/agent there repaints the same
// captions a consumer would see. Never set outside `#harness`, and outranked by an embed's own.
let harnessAudiences: readonly DecisionAudience[] | undefined;
// Set only when the MCP Apps bridge exists (never in embed mode), so theme detection can consult
// the host context without embed mode depending on the bridge.
let getHostTheme: () => string | undefined = () => undefined;

// Embed mode is decided by the fragment before the first paint, so the host-surface CSS never
// flashes. This runs synchronously at module evaluation: no await, no handshake, no host bridge.
const embed: EmbedConfig | null = parseEmbedFragment(location.hash);
const isHarness = location.hash === "#harness";
if (embed) {
  document.documentElement.dataset.embed = "";
  if (embed.theme) currentTheme = embed.theme;
}

// One reporter, driven only while the current payload is content-sized. A fill payload's height is
// whatever the parent set, so reporting it would echo the parent's own value back and close the
// feedback loop the protocol exists to avoid.
const sizeReporter = embed
  ? new SizeReporter(root, (m) => {
      // The observer can fire for the pre-render placeholder (fonts settling, the frame being
      // resized); suppress it until there is a real payload whose height means something.
      if (rendered && sizing === "content") postToParent({ ...m, sizing: "content" });
    })
  : null;
let sizing: EmbedSizing = "content";
// Nothing is reported until a payload has actually been rendered. The pre-render waiting state is
// content-shaped but says nothing about the payload to come: reporting its height let a parent
// following the documented handler shrink the frame to ~48px, and a fill chart then filled that.
let rendered = false;
// Whether the parent has been told the current payload is fill-sized, so the release is sent once.
let announcedFill = false;

function postToParent(message: BonnardWidgetMessage): void {
  parent.postMessage(message, "*");
}

function postError(code: BonnardErrorCode, message: string, renderId?: string): void {
  postToParent({ type: "bonnard:error", code, message, ...(renderId === undefined ? {} : { renderId }) });
}

function teardown() {
  for (const o of observers) o.disconnect();
  observers = [];
  for (const c of charts) c.dispose();
  charts = [];
}

/**
 * Switch the sizing mode and keep the DOM and the reporter in step. `fill` pins the height chain to
 * the iframe viewport and measures nothing; `content` leaves html/body at auto and measures.
 *
 * Entering `fill` announces it, so a parent that previously applied a content height can release it.
 * Without that signal a frame stayed stuck at the last content measurement and squashed the chart.
 */
function setSizing(next: EmbedSizing) {
  sizing = next;
  if (!embed) return;
  document.documentElement.dataset.sizing = next;
  if (next === "fill") {
    sizeReporter?.stop();
    // Once per fill episode. The parent may have applied a height for a previous content payload,
    // or for the pre-render state before it knew what was coming, and needs to let go of it.
    if (rendered && !announcedFill) {
      announcedFill = true;
      postToParent({ type: "bonnard:size", sizing: "fill", height: null, width: Math.ceil(root.scrollWidth) });
    }
  } else {
    announcedFill = false;
    sizeReporter?.start();
  }
}

// A chart that is not a table has no intrinsic height, so it fills the container. Everything else
// (KPI, text, table, empty state, fallback text) is content-height.
const chartFills = (spec: ChartSpec) => spec.chartType !== "table" && spec.data.length > 0;

function sizingForPayload(payload: Payload | null): EmbedSizing {
  if (!payload) return "content";
  if (isDashboardSpec(payload)) return "content"; // a whole grid keeps its own fixed cell heights
  if (isChartSpec(payload)) return chartFills(payload) ? "fill" : "content";
  if ("spec" in payload) return chartFills(payload.spec) ? "fill" : "content";
  return "content";
}

function paint(structured: unknown, fallbackText?: string, selected?: DashboardItem) {
  // Dashboard first: it has `items` and no top-level `data`, so it must be checked before a chart.
  if (isDashboardSpec(structured)) {
    lastPayload = structured;
    lastItem = selected;
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
    lastItem = undefined;
    // Real content the parent can size to, unlike the bare waiting state below.
    rendered = true;
    root.innerHTML = `<pre class="fallback">${esc(fallbackText)}</pre>`;
  } else {
    teardown();
    lastPayload = null;
    lastItem = undefined;
    // The pre-render placeholder. Deliberately does NOT count as rendered: its height must never
    // drive the parent's frame, since the payload it is waiting for may well be fill-sized.
    rendered = false;
    root.innerHTML = `<div class="empty">Waiting for chart data…</div>`;
  }
  if (lastPayload) rendered = true;
  setSizing(sizingForPayload(lastItem ?? lastPayload));
  if (rendered && sizing === "content") sizeReporter?.schedule();
}

// Mount one ECharts instance (with its own ResizeObserver) into a target element.
function mountChart(el: HTMLElement, spec: ChartSpec) {
  const c = echarts.init(el, themeName(currentTheme), { renderer: "svg" });
  // Record before setOption: a throw inside setOption must not leak an untracked instance.
  charts.push(c);
  c.setOption(specToOption(spec));
  const ro = new ResizeObserver(() => c.resize());
  ro.observe(el);
  observers.push(ro);
}

// Embed mode suppresses the widget's own title and narrows the captions to its configured
// audiences (viewer-only unless the consumer asked for more). An MCP host shows all of them.
const showTitle = () => !embed || embed.titled;
const audiences = () => embed?.audiences ?? harnessAudiences ?? ALL_AUDIENCES;
const notesFor = (spec: ChartSpec) => renderChartNotes(spec, audiences());

/**
 * The title above a single cell, honoured for every single-cell shape (chart, table, bare cell,
 * or a dashboard cell selected by `item`/`itemId`). A cell's title is its own chart's title; a
 * bare KPI/text tile has none, since its label/heading already reads as one.
 */
function soloTitle(item: DashboardItem | ChartSpec): string {
  if (!showTitle()) return "";
  const spec = isChartSpec(item) ? item : "spec" in item ? item.spec : undefined;
  const title = spec?.title;
  return title ? `<div class="title">${esc(title)}</div>` : "";
}

function renderChart(spec: ChartSpec) {
  teardown();
  const title = soloTitle(spec);
  // A 0-row result: show an explicit empty-state instead of an empty table or a blank plot.
  if (spec.data.length === 0) {
    root.innerHTML = `${title}${renderEmptyState()}${notesFor(spec)}`;
    return;
  }
  // Tables are HTML, not a charting-library job.
  if (spec.chartType === "table") {
    root.innerHTML = `${title}${renderTable(spec)}${notesFor(spec)}`;
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
  root.innerHTML = renderDashboardShell(spec, { titled: showTitle(), audiences: audiences() });
  spec.items.forEach((item, i) => {
    if (!("spec" in item)) return; // kpi/text cells are already final HTML
    const el = document.getElementById(`cell-${i}`);
    if (el) paintCell(el, item.spec);
  });
}

// One cell, no `.cell` chrome. Embed mode's core render: a bare DashboardItem, or a selected cell.
function renderItemOnly(item: DashboardItem) {
  teardown();
  root.innerHTML = soloTitle(item) + renderSingleItem(item, { audiences: audiences() });
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

/**
 * Resolve the theme by precedence: an explicit `bonnard:render` theme, then the `#embed` fragment,
 * then the host dialects (ChatGPT globals, MCP Apps host context), then the OS preference.
 */
function detectTheme(): "light" | "dark" {
  if (messageTheme) return messageTheme;
  // An embed consumer's declared theme outranks the host dialects below: those describe the MCP
  // host's chrome, which is not the surface an embedded cell lives in.
  if (embed?.theme) return embed.theme;
  const oai = window.openai?.theme;
  if (oai === "light" || oai === "dark") return oai;
  const ctx = getHostTheme();
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

// --- Embed mode -------------------------------------------------------------------------------
// Self-contained and synchronous. No MCP Apps bridge, so `bonnard:ready` cannot be sequenced
// behind a `ui/initialize` handshake that an ordinary embedding parent never answers.

function handleRender(d: Record<string, unknown>): void {
  const renderId = typeof d.renderId === "string" ? d.renderId : undefined;
  if (d.theme === "light" || d.theme === "dark") {
    messageTheme = d.theme;
    applyTheme(d.theme);
  }
  if ("tokens" in d) applyTokens(document.documentElement, sanitizeTokens(d.tokens));

  const payload = d.payload;
  const invalid = validatePayload(payload);
  if (invalid) {
    postError(invalid.code, invalid.message, renderId);
    return;
  }
  // Selection only means something for a dashboard payload; fail closed on a bad selector so a
  // typo cannot spill the whole grid into the caller's layout.
  let selected: DashboardItem | undefined;
  if (isDashboardSpec(payload)) {
    const picked = selectItem(payload, { item: d.item, itemId: d.itemId });
    if (picked && "code" in picked) {
      postError(picked.code, picked.message, renderId);
      return;
    }
    selected = picked?.item;
  } else if (d.item !== undefined || d.itemId !== undefined) {
    postError("invalid-item-selector", "item/itemId apply only to a DashboardSpec payload", renderId);
    return;
  }

  try {
    paint(payload, undefined, selected);
  } catch (e) {
    // Back to the placeholder via paint(), so `rendered` and the sizing mode reset together and the
    // dead frame cannot keep reporting a height the parent would apply.
    paint(undefined);
    postError("render-failed", e instanceof Error ? e.message : String(e), renderId);
  }
}

if (embed) {
  window.addEventListener("message", (e) => {
    // The frame is opaque-origin, so the origin string is useless, but the sender's identity is
    // not: only our own parent may drive this frame.
    if (e.source !== parent) return;
    const d = e.data as Record<string, unknown> | null;
    // `#embed` speaks only the public dialect. The harness dialect stays internal.
    if (!d || d.type !== "bonnard:render") return;
    handleRender(d);
  });
}

// --- Dev harness ------------------------------------------------------------------------------
// The internal dialect, unchanged: `#harness` accepts only `bonnard:harness-render`.

if (isHarness) {
  window.addEventListener("message", (e) => {
    const d = e.data as {
      type?: string;
      structuredContent?: unknown;
      text?: string;
      theme?: "light" | "dark";
      audiences?: unknown;
    } | null;
    if (d?.type !== "bonnard:harness-render") return;
    // A malformed list falls back to showing everything, matching the posture everywhere else here:
    // the harness is a diagnostic surface, so hiding a caption is the worse failure.
    if (Array.isArray(d.audiences) && d.audiences.every(isAudience)) harnessAudiences = d.audiences;
    if (d.theme === "light" || d.theme === "dark") applyTheme(d.theme);
    paint(d.structuredContent, d.text);
  });
}

paint(undefined);

if (embed) {
  // Announce readiness immediately, in the same synchronous turn as the first paint. A parent that
  // posted a render before this point simply gets re-fed, since it waits on ready.
  postToParent({ type: "bonnard:ready", protocolVersion: EMBED_PROTOCOL_VERSION });
}
if (isHarness) parent.postMessage({ type: "bonnard:harness-ready" }, "*");

refreshTheme(); // resolves ChatGPT / OS theme immediately (before any MCP Apps handshake)

window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", refreshTheme);

// --- MCP Apps host bridge ---------------------------------------------------------------------
// Only outside embed mode. The ext-apps App posts a `ui/initialize` request to the parent and
// installs its own message transport plus an auto-resizer; inside an embed that is a competing
// size protocol and a handshake an ordinary embedding parent never answers, so we neither
// construct it nor register its host listeners.

if (!embed) {
  const app = new App({ name: "Bonnard Chart", version: "0.1.0" });
  getHostTheme = () => app.getHostContext()?.theme;

  app.ontoolresult = (params) => {
    const text = params.content?.find((c) => c.type === "text")?.text;
    paint(params.structuredContent, text);
  };
  // Theme-change channels: MCP Apps host context, ChatGPT globals, and OS preference.
  app.onhostcontextchanged = () => refreshTheme();
  document.addEventListener("openai:set_globals", (e) => {
    if ((e as CustomEvent).detail?.globals?.theme) refreshTheme();
  });

  app
    .connect()
    .then(refreshTheme) // host context is available after connect (Cursor/Claude/Inspector)
    .catch((e) => {
      // Not running inside an MCP Apps host (e.g. ChatGPT or opened directly) — keep going.
      console.warn("MCP Apps host not detected:", e);
    });
}
