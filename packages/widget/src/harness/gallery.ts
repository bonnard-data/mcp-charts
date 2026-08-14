// The gallery: every example on one page, as a static thumbnail you can scan.
//
// Thumbnails are SSR'd SVG, not live iframes. One iframe per card would re-execute the ECharts
// module graph 50 times on every filter change, which is slower than the click-through it replaces;
// the single live widget lives in the overlay, where interactivity is the point. Rendering is
// deferred until a card is near the viewport and the browser is idle, and cached per theme.
import type { ChartSpec, Decision, DecisionKind } from "@bonnard/mcp-charts";
import { renderDashboardShell, isChartSpec, isDashboardSpec } from "../dashboard.js";
import { esc } from "../format.js";
import { renderToSvg } from "../ssr.js";
import { categories, decisionCounts, examples, filterExamples, type Example } from "./catalog.js";
import { ALL_CATEGORY, type Store, type Theme } from "./state.js";

const THUMB_WIDTH = 360;
const THUMB_HEIGHT = 200;
const CELL_WIDTH = 230;
const CELL_HEIGHT = 120;

const thumbnails = new Map<string, string>();

const idle = (fn: () => void) =>
  "requestIdleCallback" in window ? window.requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 16);

/** The audience that colours a chip. A decision addressed to several is shown as `multi`. */
function chipAudience(decision: Decision): string {
  return decision.audiences.length === 1 ? decision.audiences[0]! : "multi";
}

function renderDashboardThumb(example: Example, theme: Theme): string {
  if (!isDashboardSpec(example.payload)) return "";
  // A schematic, not the real grid: the cell ids are stripped because a gallery holds many of
  // these at once, and nothing here addresses a cell by id. Full fidelity is one click away.
  const shell = renderDashboardShell(example.payload, { titled: true }).replace(/ id="cell-\d+"/g, "");
  const svgs = example.payload.items
    .filter((item): item is { spec: ChartSpec } => "spec" in item)
    .map((cell) => renderToSvg(cell.spec, { theme, width: CELL_WIDTH, height: CELL_HEIGHT }));
  let i = 0;
  return shell.replace(/<div class="cell-chart"><\/div>/g, () => `<div class="cell-chart">${svgs[i++] ?? ""}</div>`);
}

function thumbnailHtml(example: Example, theme: Theme): string {
  const key = `${example.id}|${theme}`;
  const cached = thumbnails.get(key);
  if (cached) return cached;
  let html: string;
  try {
    html = isChartSpec(example.payload)
      ? renderToSvg(example.payload, { theme, width: THUMB_WIDTH, height: THUMB_HEIGHT })
      : renderDashboardThumb(example, theme);
  } catch (e) {
    html = `<div class="thumb-failed">${esc(e instanceof Error ? e.message : String(e))}</div>`;
  }
  thumbnails.set(key, html);
  return html;
}

function badges(example: Example): string {
  const chips: string[] = [`<span class="chip type">${esc(example.category)}</span>`];
  if (example.rowsOut !== example.rowsIn) {
    chips.push(`<span class="chip rows">${example.rowsIn} &rarr; ${example.rowsOut} rows</span>`);
  }
  for (const decision of example.decisions) {
    chips.push(
      `<span class="chip decision ${chipAudience(decision)}" title="${esc(decision.message)}">` +
        `${esc(String(decision.kind))}</span>`,
    );
  }
  for (const error of example.errors) {
    chips.push(`<span class="chip error" title="${esc(error)}">error</span>`);
  }
  return chips.join("");
}

function cardHtml(example: Example): string {
  return (
    `<article class="card" data-id="${esc(example.id)}" tabindex="0">` +
    `<div class="thumb ${example.kind}" data-thumb></div>` +
    `<div class="card-body"><div class="card-name">${esc(example.name)}</div>` +
    `<div class="chips">${badges(example)}</div></div>` +
    `<div class="card-actions">` +
    `<button data-action="copy" title="Copy this fixture for an AI, untouched">Copy for AI</button>` +
    `<button data-action="open" class="primary">Open</button>` +
    `</div></article>`
  );
}

function sidebarHtml(store: Store): string {
  const state = store.get();
  const counts = decisionCounts();
  const category = (id: string, count: number) =>
    `<button class="nav" data-category="${esc(id)}" aria-pressed="${state.category === id}">` +
    `<span>${esc(id)}</span><span class="count">${count}</span></button>`;

  const kinds = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([kind, count]) =>
        `<button class="nav kind" data-kind="${esc(kind)}" aria-pressed="${state.filter.kind === kind}">` +
        `<span>${esc(kind)}</span><span class="count">${count}</span></button>`,
    );

  return (
    `<div class="brand">Bonnard widget harness</div>` +
    `<div class="nav-group">` +
    category(ALL_CATEGORY, examples.length) +
    categories.map((c) => category(c.id, c.count)).join("") +
    `</div>` +
    `<div class="nav-title">Decisions</div>` +
    `<div class="nav-group">${kinds.join("")}</div>`
  );
}

export interface GalleryHandles {
  /** The examples currently on screen, in order. The overlay's prev/next walks this list. */
  visible(): Example[];
  refresh(): void;
}

export interface GalleryCallbacks {
  onOpen(example: Example): void;
  onCopy(example: Example): void;
}

export function mountGallery(
  sidebar: HTMLElement,
  grid: HTMLElement,
  store: Store,
  callbacks: GalleryCallbacks,
): GalleryHandles {
  let shown: Example[] = [];

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        observer.unobserve(el);
        const id = el.closest<HTMLElement>(".card")?.dataset.id;
        const example = shown.find((e) => e.id === id);
        if (!example) continue;
        idle(() => {
          el.innerHTML = thumbnailHtml(example, store.get().theme);
        });
      }
    },
    { rootMargin: "300px" },
  );

  function refresh() {
    const state = store.get();
    shown = filterExamples({
      category: state.category,
      text: state.query,
      chartType: state.filter.chartType,
      kind: state.filter.kind,
      withDecisions: state.filter.withDecisions,
    });
    sidebar.innerHTML = sidebarHtml(store);
    grid.innerHTML = shown.length
      ? shown.map(cardHtml).join("")
      : `<p class="empty-gallery">Nothing matches. Clear the filters to see all ${examples.length} examples.</p>`;
    for (const el of grid.querySelectorAll<HTMLElement>("[data-thumb]")) observer.observe(el);
  }

  sidebar.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>(".nav");
    if (!button) return;
    if (button.dataset.category) store.set({ category: button.dataset.category, filter: {} });
    else if (button.dataset.kind) {
      const kind = button.dataset.kind as DecisionKind;
      // Clicking the active kind clears it, so the sidebar is a toggle rather than a trap.
      const already = store.get().filter.kind === kind;
      store.set({ category: ALL_CATEGORY, filter: already ? {} : { kind } });
    }
  });

  grid.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".card");
    if (!card) return;
    const example = shown.find((x) => x.id === card.dataset.id);
    if (!example) return;
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "copy") callbacks.onCopy(example);
    else callbacks.onOpen(example);
  });

  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = (e.target as HTMLElement).closest<HTMLElement>(".card");
    if (!card) return;
    e.preventDefault();
    const example = shown.find((x) => x.id === card.dataset.id);
    if (example) callbacks.onOpen(example);
  });

  return { visible: () => shown, refresh };
}
