// Dev-only harness page: a gallery of every fixture, rendered by the REAL widget.
//
// The gallery's thumbnails are SSR'd from the same renderer the iframe runs; opening one hands the
// spec to a live widget over postMessage, exactly as a host delivers a tool result. Specs are built
// with core imported FROM SOURCE, so editing the renderer (main.ts, spec-to-option.ts, dashboard.ts,
// table.ts) or core inference (resolve/*, validate.ts) hot-reloads the preview.
//
// Never bundled into the shipped widget: vite build's input is index.html only, so nothing reachable
// from here (this file or src/harness/*) can reach the artifact.
import type { ChartType, DecisionKind } from "@bonnard/mcp-charts";
import { createBridge } from "./harness/bridge.js";
import { categories, decisionCounts, byId } from "./harness/catalog.js";
import { mountGallery } from "./harness/gallery.js";
import { mountOverlay } from "./harness/overlay.js";
import { buildAiReport, copyText } from "./harness/report.js";
import { audiencesFor } from "./harness/overlay.js";
import { ALL_CATEGORY, createStore, hashState, type AudienceFilter, type Theme } from "./harness/state.js";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const sidebar = el("sidebar");
const grid = el("grid");
const overlayRoot = el("overlay");
const search = el<HTMLInputElement>("q");
const typeSelect = el<HTMLSelectElement>("f-type");
const kindSelect = el<HTMLSelectElement>("f-kind");
const withDecisions = el<HTMLInputElement>("f-dec");
const audienceSelect = el<HTMLSelectElement>("f-aud");
const toastEl = el("toast");

const store = createStore(hashState());
const bridge = createBridge(el<HTMLIFrameElement>("stage"));

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 1800);
}

function option(select: HTMLSelectElement, value: string, label: string) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  select.appendChild(opt);
}

option(typeSelect, "", "any chart type");
for (const c of categories) if (c.id !== "dashboard") option(typeSelect, c.id, c.id);
option(kindSelect, "", "any decision kind");
for (const kind of [...decisionCounts().keys()].sort()) option(kindSelect, kind, kind);

const gallery = mountGallery(sidebar, grid, store, {
  onOpen: (example) => overlay.open(example),
  // The card's copy is the quick one: the fixture untouched, every audience, no hand edits, so a
  // hand-off from the gallery cannot carry a state the recipient has no way to see.
  onCopy: (example) => {
    void copyText(
      buildAiReport({
        example,
        payload: example.payload,
        ...(example.fixture ? { input: { data: example.fixture.data, opts: example.fixture.opts } } : {}),
        audience: "all",
        activeAudiences: audiencesFor("all"),
        theme: store.get().theme,
        synth: null,
        edited: false,
      }),
    ).then((ok) => toast(ok ? `Copied ${example.name}` : "Copy failed"));
  },
});

const overlay = mountOverlay({
  root: overlayRoot,
  bridge,
  store,
  visible: () => gallery.visible(),
  toast,
});

search.addEventListener("input", () => store.set({ query: search.value }));
typeSelect.addEventListener("change", () =>
  store.set({ filter: { ...store.get().filter, chartType: (typeSelect.value || undefined) as ChartType | undefined } }),
);
kindSelect.addEventListener("change", () =>
  store.set({ filter: { ...store.get().filter, kind: (kindSelect.value || undefined) as DecisionKind | undefined } }),
);
withDecisions.addEventListener("change", () =>
  store.set({ filter: { ...store.get().filter, withDecisions: withDecisions.checked || undefined } }),
);
audienceSelect.addEventListener("change", () => store.set({ audience: audienceSelect.value as AudienceFilter }));

document
  .querySelectorAll<HTMLButtonElement>("#theme button")
  .forEach((button) => button.addEventListener("click", () => store.set({ theme: button.dataset.theme as Theme })));

// Our own writes use replaceState, which is silent, so anything that fires this came from outside:
// a pasted link, an edited address bar, a bookmark. Apply it whole.
window.addEventListener("hashchange", () => store.set(hashState()));

/** Push the store back into the controls it does not own, so a hash-restored state looks restored. */
function syncControls() {
  const state = store.get();
  if (search.value !== state.query) search.value = state.query;
  typeSelect.value = state.filter.chartType ?? "";
  kindSelect.value = state.filter.kind ?? "";
  withDecisions.checked = !!state.filter.withDecisions;
  audienceSelect.value = state.audience;
  document.documentElement.dataset.theme = state.theme;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#theme button")) {
    button.setAttribute("aria-pressed", String(button.dataset.theme === state.theme));
  }
}

store.subscribe((state, previous) => {
  syncControls();
  const listChanged =
    state.category !== previous.category ||
    state.query !== previous.query ||
    state.filter !== previous.filter ||
    // A theme change invalidates every cached thumbnail, so the grid has to be rebuilt.
    state.theme !== previous.theme;
  if (listChanged) gallery.refresh();
  overlay.refresh();
});

syncControls();
gallery.refresh();
// A hash naming an example that no longer exists must not leave a dead overlay open.
if (store.get().selectedId && !byId.has(store.get().selectedId!)) {
  store.set({ selectedId: null, overlayOpen: false, category: ALL_CATEGORY });
}
overlay.refresh();
