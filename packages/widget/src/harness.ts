// Dev-only harness page. Renders the REAL widget (index.html#harness) in an iframe and feeds it a
// ChartSpec/DashboardSpec via postMessage, exactly like a host delivers a tool result. The spec is
// produced by core's resolve() imported FROM SOURCE, so editing either the renderer (main.ts,
// spec-to-option.ts, dashboard.ts, table.ts) or core inference (resolve/*, validate.ts) hot-reloads
// the preview. Never bundled into the shipped widget: vite build's input is index.html only.
import { resolve } from "../../core/src/resolve/resolve.js";
import type { ChartData, ResolveOptions, ChartSpec, DashboardSpec } from "@bonnard/mcp-charts";
import { fixtures } from "../test/fixtures.js";

type Mode = "data" | "spec";
type Theme = "light" | "dark";

const iframe = document.getElementById("stage") as HTMLIFrameElement;
const editor = document.getElementById("editor") as HTMLTextAreaElement;
const fixtureSel = document.getElementById("fixture") as HTMLSelectElement;
const errEl = document.getElementById("err") as HTMLDivElement;

let mode: Mode = "data";
let theme: Theme = "light";

// A dashboard example assembled from existing chart fixtures, so the dashboard renderer
// (grid, cell notes, KPI/text tiles) is exercisable alongside single charts.
function dashboardSample(): DashboardSpec {
  const cell = (name: string, span = 1) => {
    const f = fixtures.find((x) => x.name === name)!;
    return { type: "chart" as const, spec: resolve(f.data, f.opts), span };
  };
  return {
    title: "Sample dashboard",
    columns: 3,
    items: [
      { type: "kpi", label: "Revenue", value: "$53.5K", delta: 0.12, caption: "vs last month" },
      cell("bar-revenue-by-status"),
      cell("pie-region"),
      cell("line-monthly", 2),
      cell("bar-long-labels"),
    ] as DashboardSpec["items"],
  };
}

// Left-panel entries. Chart fixtures feed data+opts through resolve(); the dashboard entry is a
// prebuilt DashboardSpec (rendered raw in "spec" mode).
interface Entry {
  name: string;
  kind: "fixture" | "dashboard";
}
const entries: Entry[] = [
  ...fixtures.map((f): Entry => ({ name: f.name, kind: "fixture" })),
  { name: "▸ dashboard sample", kind: "dashboard" },
];

function loadEntry(name: string) {
  const entry = entries.find((e) => e.name === name);
  if (!entry) return;
  if (entry.kind === "dashboard") {
    mode = "spec";
    editor.value = JSON.stringify(dashboardSample(), null, 2);
  } else {
    const f = fixtures.find((x) => x.name === entry.name)!;
    mode = "data";
    editor.value = JSON.stringify({ data: f.data, opts: f.opts }, null, 2);
  }
  syncModeButtons();
  render();
}

// Parse the editor and produce the payload the widget expects (a ChartSpec or DashboardSpec).
function currentPayload(): ChartSpec | DashboardSpec {
  const parsed = JSON.parse(editor.value);
  if (mode === "data") {
    const { data, opts } = parsed as { data: ChartData; opts?: ResolveOptions };
    return resolve(data, opts ?? {});
  }
  return parsed as ChartSpec | DashboardSpec;
}

function render() {
  try {
    const payload = currentPayload();
    errEl.textContent = "";
    iframe.contentWindow?.postMessage({ type: "bonnard:harness-render", structuredContent: payload, theme }, "*");
  } catch (e) {
    errEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

function syncModeButtons() {
  document
    .querySelectorAll<HTMLButtonElement>("#mode button")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
}

// Populate fixture picker
for (const e of entries) {
  const o = document.createElement("option");
  o.value = e.name;
  o.textContent = e.name;
  fixtureSel.appendChild(o);
}

fixtureSel.addEventListener("change", () => loadEntry(fixtureSel.value));
document.getElementById("render")!.addEventListener("click", render);

// Re-render on edit (debounced), so tweaking the JSON updates the preview live.
let t: ReturnType<typeof setTimeout>;
editor.addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(render, 250);
});
editor.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    render();
  }
});

document.querySelectorAll<HTMLButtonElement>("#mode button").forEach((b) =>
  b.addEventListener("click", () => {
    mode = b.dataset.mode as Mode;
    syncModeButtons();
    render();
  }),
);
document.querySelectorAll<HTMLButtonElement>("#theme button").forEach((b) =>
  b.addEventListener("click", () => {
    theme = b.dataset.theme as Theme;
    document
      .querySelectorAll<HTMLButtonElement>("#theme button")
      .forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.theme === theme)));
    document.documentElement.dataset.theme = theme;
    render();
  }),
);

// The widget iframe posts this after it (re)loads — including after a Vite full-reload triggered by
// a renderer source edit. Re-feeding the current payload is what makes editing the renderer feel
// like HMR: change spec-to-option.ts, the iframe reloads, and the same chart repaints instantly.
window.addEventListener("message", (e) => {
  if ((e.data as { type?: string } | null)?.type === "bonnard:harness-ready") render();
});

loadEntry(entries[0]!.name);
