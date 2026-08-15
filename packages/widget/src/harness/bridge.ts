// The link to the real widget: one live iframe, driven exactly as a host drives it, over the
// internal `bonnard:harness-*` dialect. Unchanged from the harness this replaces except for the
// `audiences` field, which is what lets the overlay's toggle repaint captions on a live frame.
import type { DecisionAudience } from "@bonnard/mcp-charts";
import type { Payload } from "./pipeline.js";

export interface RenderOptions {
  theme: "light" | "dark";
  audiences: readonly DecisionAudience[];
}

export interface Bridge {
  render(payload: Payload, opts: RenderOptions): void;
  /** Coalesce keystrokes in the JSON pane; the last one within the window wins. */
  renderDebounced(payload: Payload, opts: RenderOptions): void;
}

const DEBOUNCE_MS = 250;

export function createBridge(iframe: HTMLIFrameElement): Bridge {
  let last: { payload: Payload; opts: RenderOptions } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const post = () => {
    if (!last) return;
    iframe.contentWindow?.postMessage(
      {
        type: "bonnard:harness-render",
        structuredContent: last.payload,
        theme: last.opts.theme,
        audiences: last.opts.audiences,
      },
      "*",
    );
  };

  // The frame posts this after every (re)load, including a Vite full-reload triggered by a renderer
  // edit. Re-feeding the current payload is what makes editing the renderer feel like HMR: change
  // spec-to-option.ts, the iframe reloads, and the same chart repaints instantly.
  window.addEventListener("message", (e) => {
    if ((e.data as { type?: string } | null)?.type === "bonnard:harness-ready") post();
  });

  return {
    render(payload, opts) {
      clearTimeout(timer);
      last = { payload, opts };
      post();
    },
    renderDebounced(payload, opts) {
      clearTimeout(timer);
      last = { payload, opts };
      timer = setTimeout(post, DEBOUNCE_MS);
    },
  };
}
