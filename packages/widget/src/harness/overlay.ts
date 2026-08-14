// The overlay: one example, full size, in the real widget, with everything you need to answer
// "why does it look like that" next to it.
//
// Arrow keys move to the next example WITHOUT closing, which is the whole point of the gallery
// sitting behind it: a review pass is flicking through twenty charts, not opening and closing one.
import type { ChartData, Decision, DecisionAudience } from "@bonnard/mcp-charts";
import { ALL_AUDIENCES } from "../decisions.js";
import { esc } from "../format.js";
import type { Bridge } from "./bridge.js";
import { byId, type Example } from "./catalog.js";
import { buildChartSpec, buildFromJson, type Payload } from "./pipeline.js";
import { buildAiReport, copyText, specJson, truncateArrays } from "./report.js";
import { DENSITY_STEPS, supportsSynth, synthesize } from "./synth.js";
import type { AudienceFilter, Store } from "./state.js";

// Above this the JSON pane shows a truncated view and stops accepting edits: a hand edit applied
// to a shortened row list would quietly render a different dataset than the one on screen.
const EDITABLE_ROW_LIMIT = 200;

const AUDIENCE_CHOICES: AudienceFilter[] = ["all", "viewer", "author", "agent"];

export function audiencesFor(filter: AudienceFilter): readonly DecisionAudience[] {
  return filter === "all" ? ALL_AUDIENCES : [filter];
}

export interface OverlayHandles {
  open(example: Example): void;
  refresh(): void;
}

export interface OverlayDeps {
  root: HTMLElement;
  bridge: Bridge;
  store: Store;
  /** The gallery's current filtered order, which prev/next walks. */
  visible(): Example[];
  toast(message: string): void;
}

interface Resolved {
  example: Example;
  payload: Payload;
  /** The `{ data, opts }` side, when there is one. A dashboard fixture has no single input. */
  input?: { data: ChartData; opts: unknown };
  error?: string;
  rowCount: number;
}

const rowsOf = (payload: Payload) => ("data" in payload && Array.isArray(payload.data) ? payload.data.length : 0);

function decisionsOf(payload: Payload): Decision[] {
  if (!("items" in payload)) return payload.decisions ?? [];
  return [...(payload.decisions ?? []), ...payload.items.flatMap((i) => ("spec" in i ? (i.spec.decisions ?? []) : []))];
}

function errorsOf(payload: Payload): string[] {
  if (!("items" in payload)) return [];
  return payload.items.map((i) => (i as { error?: unknown }).error).filter((e): e is string => typeof e === "string");
}

const chipClass = (d: Decision) => (d.audiences.length === 1 ? d.audiences[0]! : "multi");

export function mountOverlay(deps: OverlayDeps): OverlayHandles {
  const { root, bridge, store, visible, toast } = deps;
  const header = root.querySelector<HTMLElement>("[data-header]")!;
  const audienceBar = root.querySelector<HTMLElement>("[data-audience-bar]")!;
  const decisionsSlot = root.querySelector<HTMLElement>("[data-decisions]")!;
  const errorsSlot = root.querySelector<HTMLElement>("[data-errors]")!;
  const jsonSlot = root.querySelector<HTMLElement>("[data-json]")!;
  const densitySlot = root.querySelector<HTMLElement>("[data-density]")!;

  // True only while the JSON pane is being typed into, so a re-render leaves the textarea (and the
  // caret) exactly where the hands are.
  let typing = false;
  // What the "what looks wrong" note was written about. Carrying it onto the next example would
  // put a complaint about one chart into a report about another.
  let notedId: string | null = null;

  /** The data actually being rendered: the fixture's own rows, or a synthetic stand-in. */
  function effectiveData(example: Example): ChartData | undefined {
    const { synth } = store.get();
    if (!example.fixture) return undefined;
    if (!synth || !supportsSynth(example.chartType)) return example.fixture.data;
    return synthesize(example.fixture, synth.rows, synth.seed);
  }

  function resolveCurrent(): Resolved | null {
    const state = store.get();
    const example = state.selectedId ? byId.get(state.selectedId) : undefined;
    if (!example) return null;

    if (state.editorText != null) {
      const built = buildFromJson(state.editorText, state.jsonView);
      return built.ok
        ? { example, payload: built.payload, rowCount: rowsOf(built.payload) }
        : { example, payload: example.payload, error: built.error, rowCount: rowsOf(example.payload) };
    }

    const data = effectiveData(example);
    if (!data || !example.fixture) return { example, payload: example.payload, rowCount: rowsOf(example.payload) };
    try {
      const payload = buildChartSpec(data, example.fixture.opts);
      return { example, payload, input: { data, opts: example.fixture.opts }, rowCount: payload.data.length };
    } catch (e) {
      return { example, payload: example.payload, error: e instanceof Error ? e.message : String(e), rowCount: 0 };
    }
  }

  function renderHeader(current: Resolved) {
    const { synth } = store.get();
    const list = visible();
    const index = list.findIndex((e) => e.id === current.example.id);
    const position = index >= 0 ? `${index + 1} / ${list.length}` : `not in the current filter`;
    const synthChip = synth
      ? `<span class="chip synthetic">synthetic: ${synth.rows.toLocaleString("en-US")} rows, seed ${synth.seed}</span>`
      : "";
    const chips = decisionsOf(current.payload)
      .map((d) => `<span class="chip decision ${chipClass(d)}">${esc(String(d.kind))}</span>`)
      .join("");
    header.innerHTML =
      `<div class="ov-title"><h2>${esc(current.example.name)}</h2>` +
      `<div class="chips"><span class="chip type">${esc(current.example.category)}</span>${synthChip}${chips}</div></div>` +
      `<div class="ov-nav"><span class="muted">${esc(position)}</span>` +
      `<button data-action="prev" title="Previous example (left arrow)">&larr;</button>` +
      `<button data-action="next" title="Next example (right arrow)">&rarr;</button>` +
      `<button data-action="close" title="Close (Esc)">Close</button></div>`;
  }

  function renderAudienceBar() {
    const { audience } = store.get();
    audienceBar.innerHTML =
      `<h3>Audience</h3><div class="seg wide">` +
      AUDIENCE_CHOICES.map((a) => `<button data-audience="${a}" aria-pressed="${audience === a}">${a}</button>`).join(
        "",
      ) +
      `</div><p class="muted">The captions a surface configured for this audience would draw.</p>`;
  }

  function renderDecisions(current: Resolved) {
    const active = audiencesFor(store.get().audience);
    const decisions = decisionsOf(current.payload);
    if (decisions.length === 0) {
      decisionsSlot.innerHTML = `<h3>Decisions</h3><p class="muted">This render reported no decisions.</p>`;
      return;
    }
    // Filtered-out rows are dimmed, not removed: "why did that caption vanish" has to stay
    // answerable from the same screen that made it vanish.
    const rows = decisions
      .map((d) => {
        const shown = d.audiences.some((a) => active.includes(a));
        return (
          `<tr class="${shown ? "" : "dimmed"}"><td><code>${esc(String(d.kind))}</code></td>` +
          `<td>${esc(d.audiences.join(", "))}</td><td>${shown ? "shown" : "hidden"}</td>` +
          `<td>${esc(d.message)}</td></tr>`
        );
      })
      .join("");
    decisionsSlot.innerHTML =
      `<h3>Decisions</h3><table class="decisions">` +
      `<thead><tr><th>kind</th><th>audiences</th><th>here</th><th>message</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>`;
  }

  function renderErrors(current: Resolved) {
    const errors = errorsOf(current.payload);
    const parse = current.error ? `<li class="parse">${esc(current.error)}</li>` : "";
    // Always rendered, never audience-filtered: a hard failure is not an advisory.
    errorsSlot.innerHTML =
      errors.length || parse
        ? `<h3>Errors</h3><ul class="errors">${parse}${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
        : "";
  }

  function renderJson(current: Resolved) {
    const state = store.get();
    const value = state.jsonView === "spec" ? current.payload : (current.input ?? current.payload);
    // The input side can be far larger than the spec (a 5,000-row input capped to 30 bars), so the
    // limit applies to whichever side is actually on screen.
    const rows = state.jsonView === "spec" ? current.rowCount : (current.input?.data.rows.length ?? current.rowCount);
    const truncated = rows > EDITABLE_ROW_LIMIT;
    const text = JSON.stringify(truncated ? truncateArrays(value) : value, null, 2);
    jsonSlot.innerHTML =
      `<h3>JSON<span class="seg small">` +
      `<button data-json="input" aria-pressed="${state.jsonView === "input"}"${current.input ? "" : " disabled"}>input</button>` +
      `<button data-json="spec" aria-pressed="${state.jsonView === "spec"}">spec</button></span></h3>` +
      (truncated
        ? `<p class="muted">${rows.toLocaleString("en-US")} rows: shown truncated and read-only. "Copy JSON" gives you all of it.</p>`
        : "") +
      `<textarea data-editor spellcheck="false"${truncated ? " readonly" : ""}>${esc(text)}</textarea>` +
      `<div class="json-error" data-json-error></div>`;
  }

  function renderDensity(example: Example) {
    if (!example.fixture || !supportsSynth(example.chartType)) {
      densitySlot.innerHTML = `<span class="muted">Synthetic data is off for ${esc(example.category)}: random values say nothing about share, stage or bridge semantics.</span>`;
      return;
    }
    const { synth } = store.get();
    densitySlot.innerHTML =
      `<span class="label">Rows</span><div class="seg">` +
      DENSITY_STEPS.map(
        (n) => `<button data-density="${n}" aria-pressed="${synth?.rows === n}">${n.toLocaleString("en-US")}</button>`,
      ).join("") +
      `</div><button data-action="reseed"${synth ? "" : " disabled"}>New seed</button>` +
      `<button data-action="reset-data"${synth ? "" : " disabled"}>Reset to fixture data</button>`;
  }

  function render() {
    const state = store.get();
    const current = resolveCurrent();
    root.hidden = !state.overlayOpen || !current;
    if (!current || !state.overlayOpen) return;
    if (notedId !== current.example.id) {
      const note = root.querySelector<HTMLInputElement>("[data-note]");
      if (note) note.value = "";
      notedId = current.example.id;
    }
    renderHeader(current);
    renderAudienceBar();
    renderDecisions(current);
    renderErrors(current);
    if (!typing) renderJson(current);
    renderDensity(current.example);
    bridge.render(current.payload, { theme: state.theme, audiences: audiencesFor(state.audience) });
  }

  function step(delta: number) {
    const list = visible();
    if (list.length === 0) return;
    const index = list.findIndex((e) => e.id === store.get().selectedId);
    const next = list[(index + delta + list.length) % list.length]!;
    store.set({ selectedId: next.id, editorText: null, synth: null });
  }

  async function copyReport(current: Resolved) {
    const state = store.get();
    const note = root.querySelector<HTMLInputElement>("[data-note]")?.value.trim();
    const ok = await copyText(
      buildAiReport({
        // Everything derived is recomputed from what is actually on screen: under synthetic data or
        // a hand edit, the catalog's own counts and decisions describe a render nobody is looking at.
        example: {
          ...current.example,
          decisions: decisionsOf(current.payload),
          errors: errorsOf(current.payload),
          rowsIn: current.input?.data.rows.length ?? current.example.rowsIn,
          rowsOut: current.rowCount,
        },
        payload: current.payload,
        input: current.input,
        audience: state.audience,
        activeAudiences: audiencesFor(state.audience),
        theme: state.theme,
        synth: state.synth,
        edited: state.editorText != null,
        ...(note ? { note } : {}),
      }),
    );
    toast(ok ? "Report copied" : "Copy failed");
  }

  root.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!button) return;
    const { audience, json, density, action } = button.dataset;
    if (audience) store.set({ audience: audience as AudienceFilter });
    else if (json) store.set({ jsonView: json as "input" | "spec", editorText: null });
    else if (density) {
      const synth = store.get().synth;
      store.set({ synth: { rows: Number(density), seed: synth?.seed ?? 1 }, editorText: null });
    } else if (action === "reseed") {
      const synth = store.get().synth;
      if (synth) store.set({ synth: { rows: synth.rows, seed: synth.seed + 1 }, editorText: null });
    } else if (action === "reset-data") store.set({ synth: null, editorText: null });
    else if (action === "prev") step(-1);
    else if (action === "next") step(1);
    else if (action === "close") store.set({ overlayOpen: false });
    else if (action === "copy-ai") {
      const current = resolveCurrent();
      if (current) void copyReport(current);
    } else if (action === "copy-json") {
      const current = resolveCurrent();
      if (current)
        void copyText(specJson(current.payload)).then((ok) => toast(ok ? "Spec JSON copied" : "Copy failed"));
    }
  });

  // Typing re-renders live (debounced), so a tweak shows up without a round trip through a button.
  root.addEventListener("input", (e) => {
    const editor = e.target as HTMLElement;
    if (!editor.matches("[data-editor]")) return;
    typing = true;
    store.set({ editorText: (editor as HTMLTextAreaElement).value });
    typing = false;
    const built = buildFromJson((editor as HTMLTextAreaElement).value, store.get().jsonView);
    root.querySelector<HTMLElement>("[data-json-error]")!.textContent = built.ok ? "" : built.error;
    if (built.ok) {
      bridge.renderDebounced(built.payload, {
        theme: store.get().theme,
        audiences: audiencesFor(store.get().audience),
      });
    }
  });

  root.addEventListener("keydown", (e) => {
    const editor = e.target as HTMLElement;
    if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter" || !editor.matches("[data-editor]")) return;
    e.preventDefault();
    const built = buildFromJson((editor as HTMLTextAreaElement).value, store.get().jsonView);
    if (built.ok) {
      bridge.render(built.payload, { theme: store.get().theme, audiences: audiencesFor(store.get().audience) });
    }
  });

  // Global keys, but never while typing into the JSON pane or the note field.
  window.addEventListener("keydown", (e) => {
    if (!store.get().overlayOpen) return;
    if (e.key === "Escape") {
      store.set({ overlayOpen: false });
      return;
    }
    const target = e.target;
    if (target instanceof Element && target.closest("textarea, input")) return;
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  });

  return {
    open(example) {
      store.set({ selectedId: example.id, overlayOpen: true, editorText: null, synth: null });
    },
    refresh: render,
  };
}
