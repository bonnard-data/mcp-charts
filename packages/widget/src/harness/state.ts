// Every decision about what you are currently looking at, in one store. The gallery and the
// overlay only read it and subscribe, so there is one place to answer "why is this on screen".
//
// The subset that identifies a view rides `location.hash`. Vite full-reloads this page on every
// renderer edit, and losing your place on each one is the difference between a usable QA pass and
// a frustrating one.
import type { ChartType, DecisionAudience, DecisionKind } from "@bonnard/mcp-charts";

export type AudienceFilter = "all" | DecisionAudience;
export type Theme = "light" | "dark";
export type JsonView = "input" | "spec";

export interface HarnessFilter {
  chartType?: ChartType;
  kind?: DecisionKind;
  withDecisions?: boolean;
}

/** Synthetic data standing in for the fixture's own rows. Never a mutation of the fixture. */
export interface SynthState {
  rows: number;
  seed: number;
}

export interface HarnessState {
  category: string;
  query: string;
  filter: HarnessFilter;
  selectedId: string | null;
  overlayOpen: boolean;
  audience: AudienceFilter;
  theme: Theme;
  jsonView: JsonView;
  /** A hand edit in the overlay's JSON pane. Deliberately NOT persisted: a stale edit silently
   *  overriding a fixture would make the harness lie about what it is showing. */
  editorText: string | null;
  synth: SynthState | null;
}

export const ALL_CATEGORY = "all";

export const DEFAULT_STATE: HarnessState = {
  category: ALL_CATEGORY,
  query: "",
  filter: {},
  selectedId: null,
  overlayOpen: false,
  audience: "all",
  theme: "light",
  jsonView: "input",
  editorText: null,
  synth: null,
};

export type Listener = (state: HarnessState, previous: HarnessState) => void;

export interface Store {
  get(): HarnessState;
  set(patch: Partial<HarnessState>): void;
  subscribe(listener: Listener): void;
}

const isAudienceFilter = (v: string): v is AudienceFilter =>
  v === "all" || v === "viewer" || v === "author" || v === "agent";

/** The identifying subset of the state, read back from the URL after a reload. */
export function readHash(hash: string = location.hash): Partial<HarnessState> {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const out: Partial<HarnessState> = {};
  const id = params.get("e");
  if (id) {
    out.selectedId = id;
    out.overlayOpen = params.get("o") !== "0";
  }
  const audience = params.get("a");
  if (audience && isAudienceFilter(audience)) out.audience = audience;
  const theme = params.get("t");
  if (theme === "light" || theme === "dark") out.theme = theme;
  const view = params.get("j");
  if (view === "input" || view === "spec") out.jsonView = view;
  const rows = Number(params.get("n"));
  const seed = Number(params.get("s"));
  if (Number.isFinite(rows) && rows > 0) out.synth = { rows, seed: Number.isFinite(seed) ? seed : 1 };
  return out;
}

/** The full persisted subset: what the hash says, with defaults for whatever it leaves out. Used
 *  both at boot and on `hashchange`, so a pasted URL lands on exactly the state it describes
 *  rather than layering onto whatever was already on screen. */
export function hashState(hash: string = location.hash): Partial<HarnessState> {
  return {
    selectedId: null,
    overlayOpen: false,
    audience: "all",
    theme: "light",
    jsonView: "input",
    synth: null,
    editorText: null,
    ...readHash(hash),
  };
}

function toHash(state: HarnessState): string {
  const params = new URLSearchParams();
  if (state.selectedId) {
    params.set("e", state.selectedId);
    if (!state.overlayOpen) params.set("o", "0");
  }
  if (state.audience !== "all") params.set("a", state.audience);
  if (state.theme !== "light") params.set("t", state.theme);
  if (state.jsonView !== "input") params.set("j", state.jsonView);
  if (state.synth) {
    params.set("n", String(state.synth.rows));
    params.set("s", String(state.synth.seed));
  }
  const query = params.toString();
  return query ? `#${query}` : "";
}

export function createStore(initial: Partial<HarnessState> = {}): Store {
  let state: HarnessState = { ...DEFAULT_STATE, ...initial };
  const listeners: Listener[] = [];

  return {
    get: () => state,
    set(patch) {
      const previous = state;
      state = { ...state, ...patch };
      const next = toHash(state);
      // replaceState, not a hash assignment: the back button should leave the harness, not walk
      // back through every filter keystroke.
      if (next !== toHash(previous)) history.replaceState(null, "", next || location.pathname);
      for (const listener of listeners) listener(state, previous);
    },
    subscribe(listener) {
      listeners.push(listener);
    },
  };
}
