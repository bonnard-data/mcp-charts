// The preview shell page: a control bar + the REAL embedded widget in an iframe at /widget#harness,
// fed specs over the widget's harness postMessage protocol (the same one the internal dev harness
// speaks). The spec itself travels via fetch("/spec"), not inlined here, so watch/re-run is just a
// version bump announced over SSE.

export interface ShellHtmlOptions {
  /** Shown in the control bar: the spec file path or "tool on url". */
  source: string;
  mode: "file" | "mcp";
  theme: "light" | "dark";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderShellHtml(opts: ShellHtmlOptions): string {
  const config = JSON.stringify({ theme: opts.theme, mode: opts.mode }).replace(/</g, "\\u003c");
  const rerunLabel = opts.mode === "mcp" ? "Re-run tool" : "Reload file";
  return `<!doctype html>
<html lang="en" data-theme="${opts.theme}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>mcp-charts preview</title>
    <style>
      :root { --bg: #f6f7f9; --fg: #1a1a1a; --muted: #6b7280; --border: #e5e7eb; --err-bg: #fef2f2; --err-fg: #b91c1c; }
      html[data-theme="dark"] { --bg: #111418; --fg: #e5e7eb; --muted: #9ca3af; --border: #2d333b; --err-bg: #3a1d1d; --err-fg: #fca5a5; }
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body { display: flex; flex-direction: column; background: var(--bg); color: var(--fg);
        font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
      header .name { font-weight: 600; }
      header .source { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
      button { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--border);
        border-radius: 6px; padding: 3px 10px; cursor: pointer; }
      button[aria-pressed="true"] { background: var(--fg); color: var(--bg); }
      #err { display: none; padding: 6px 12px; background: var(--err-bg); color: var(--err-fg);
        border-bottom: 1px solid var(--border); white-space: pre-wrap; }
      iframe { flex: 1; width: 100%; border: 0; background: #fff; }
      html[data-theme="dark"] iframe { background: #111418; }
    </style>
  </head>
  <body>
    <header>
      <span class="name">mcp-charts preview</span>
      <span class="source" title="${esc(opts.source)}">${esc(opts.source)}</span>
      <span id="theme">
        <button data-theme-btn="light">Light</button>
        <button data-theme-btn="dark">Dark</button>
      </span>
      <button id="rerun">${rerunLabel}</button>
    </header>
    <div id="err"></div>
    <iframe id="stage" src="/widget#harness" title="chart widget"></iframe>
    <script>
      const cfg = ${config};
      let theme = cfg.theme;
      let payload = null;
      const iframe = document.getElementById("stage");
      const errEl = document.getElementById("err");

      function feed() {
        if (!payload) return;
        iframe.contentWindow.postMessage(
          { type: "bonnard:harness-render", structuredContent: payload, theme },
          "*",
        );
      }

      async function refresh() {
        try {
          const state = await (await fetch("/spec")).json();
          errEl.style.display = state.error ? "block" : "none";
          errEl.textContent = state.error ?? "";
          if (state.payload) {
            payload = state.payload;
            feed();
          }
        } catch (e) {
          errEl.style.display = "block";
          errEl.textContent = "preview server unreachable: " + e;
        }
      }

      // The widget posts harness-ready when (re)loaded; the load event is a fallback for embeds
      // that predate the handshake.
      window.addEventListener("message", (e) => {
        if (e.data && e.data.type === "bonnard:harness-ready") feed();
      });
      iframe.addEventListener("load", feed);

      new EventSource("/events").addEventListener("render", refresh);

      function setTheme(next) {
        theme = next;
        document.documentElement.dataset.theme = next;
        document.querySelectorAll("[data-theme-btn]").forEach((b) => {
          b.setAttribute("aria-pressed", String(b.dataset.themeBtn === next));
        });
        feed();
      }
      document.querySelectorAll("[data-theme-btn]").forEach((b) => {
        b.addEventListener("click", () => setTheme(b.dataset.themeBtn));
      });
      setTheme(theme);

      document.getElementById("rerun").addEventListener("click", () => {
        fetch("/rerun", { method: "POST" }).catch(() => {});
      });

      refresh();
    </script>
  </body>
</html>
`;
}
