# CLAUDE.md — bonnard-mcp-charts

OSS (MIT) horizontal MCP charting/dashboards library. A dev returns a `ChartSpec`/`DashboardSpec`
from an MCP tool; the embedded widget renders it with ECharts inside the host (Claude Desktop /
ChatGPT / MCP Inspector). Its own git repo (`bonnard-data/mcp-charts`), nested inside the outer
`data-mcp` git and a sibling of `mcp-platform` — they are separate gits; `Agent isolation:"worktree"`
can grab the wrong copy, so make a MANUAL worktree of THIS repo if isolating.

## Layout
- `packages/core` (`@bonnard/mcp-charts`, tsup) — the render compiler (`resolve()`), types, the DX
  helpers (`chart`/`chartCell`/`dashboardResult`/`addDashboardTool`/`addDashboardViews`), and the
  embedded widget HTML.
- `packages/widget` (`@bonnard/mcp-charts-widget`, vite) — the in-iframe renderer. Builds to ONE
  inlined `dist/index.html`, embedded into core via `packages/core/scripts/embed-widget.mjs` ->
  `packages/core/src/generated/widget-html.ts`. **Edit widget -> `pnpm build` re-embeds it into core.**
- `examples/{dashboard,quickstart}` — runnable MCP servers (stateless Streamable HTTP at `/mcp`).
- `packages/create-mcp-charts` — the `npm create @bonnard/mcp-charts` scaffold generator (private).
- Docs: `docs/DEV-{LOOP,TUNNEL,HARNESS}.md`, `docs/INTERACTIVITY-CALLBACK-DEEPDIVE.md`.

## Build / test
- `pnpm build` — widget (single-file) then core (embeds widget). `pnpm typecheck`, `pnpm test`
  (196 core + 59 widget), `pnpm lint`, `pnpm check` (format + lint + typecheck).

## Dev loop (pick by what you're editing — full detail in docs/DEV-LOOP.md)
- **Widget renderer / core inference** -> `pnpm dev:harness` — HMR preview: the real widget in an
  iframe, fed specs from core `resolve()` (source), no build/embed/restart. (docs/DEV-HARNESS.md)
- **Example server / views, or a real-host demo** -> `scripts/dev-tunnel.sh` — boots the example
  server in watch mode + a STABLE ngrok static URL so Claude Desktop reconnects. Port **3020**.
  (docs/DEV-TUNNEL.md)
- **Driving the MCP tools** -> `pnpm dev:inspect` — MCP Inspector against the example server (port 3011).
- **Before a release** -> `pnpm uat` — render-pipeline gate: renders every view + all fixtures
  through SSR, fails on blank charts. Port 3021.
- **Fresh consumer project** -> `npm create @bonnard/mcp-charts my-server` (local:
  `node packages/create-mcp-charts/bin/index.mjs <dir>`).

Ports are chosen to avoid collisions: tunnel **3020**, uat **3021**, inspect **3011**, and the
mcp-platform backend owns **3000**. ngrok auth is the "bon" account authtoken in treekey
(`ngrok/BON_AUTHTOKEN`); never print it (see docs/DEV-TUNNEL.md for the config-precedence gotcha).

## Release
Changeset-driven: `pnpm changeset` -> `pnpm version-packages` -> `pnpm release` (build + publish).
Core is at `0.1.2`; next publish is **0.2.0** (staged changesets: dashboard-spec, inference-guardrails).
**Do NOT publish casually** — publishing is a deliberate, separate step.

## Conventions
Comments: limited and refined, only when needed; clarify non-obvious behavior, don't narrate
decisions. Prefer clear names. No emojis, no em-dashes. Commit trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Sole-dev workflow: short-lived
branch -> review -> merge to `main` locally; no PRs.
