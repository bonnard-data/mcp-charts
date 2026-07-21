# CLAUDE.md — bonnard-mcp-charts

OSS (MIT) horizontal MCP charting/dashboards library. A dev returns a `ChartSpec`/`DashboardSpec`
from an MCP tool; the embedded widget renders it with ECharts inside the host (Claude Desktop /
ChatGPT / MCP Inspector). Its own git repo (`bonnard-data/mcp-charts`), nested inside the outer
`data-mcp` git and a sibling of `mcp-platform` — they are separate gits; `Agent isolation:"worktree"`
can grab the wrong copy, so make a MANUAL worktree of THIS repo if isolating.

## Layout
- `packages/core` (`@bonnard/mcp-charts`, tsup) — the render compiler (`resolve()`), types, the DX
  helpers (`chart`/`chartCell`/`dashboardResult`/`addViews`), and the embedded widget HTML.
- `packages/widget` (`@bonnard/mcp-charts-widget`, vite) — the in-iframe renderer. Builds to ONE
  inlined `dist/index.html`, embedded into core via `packages/core/scripts/embed-widget.mjs` ->
  `packages/core/src/generated/widget-html.ts`. **Edit widget -> `pnpm build` re-embeds it into core.**
- `examples/{dashboard,quickstart}` — runnable MCP servers (stateless Streamable HTTP at `/mcp`).
- `packages/create-mcp-charts` — the `npm create @bonnard/mcp-charts` scaffold generator (private).
- Docs: `docs/DEV-{LOOP,TUNNEL,HARNESS}.md`, `docs/INTERACTIVITY-CALLBACK-DEEPDIVE.md`.

## Build / test
- `pnpm build` — widget (single-file) then core (embeds widget). `pnpm typecheck`, `pnpm test`
  (199 core + 59 widget), `pnpm lint`, `pnpm check` (format + lint + typecheck).

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

## Release (publish to npm)
Changesets-driven, in GitHub Actions (`release.yml`) on push to `main`.
- Per change: run `pnpm changeset`, pick the bump (patch/minor/major), write a one-line summary. It
  commits a `.changeset/*.md` next to your code.
- On push to `main`, `changesets/action` opens or updates a "Version Packages" PR that runs
  `changeset version`: it aggregates the pending changesets into one bump, updates
  `packages/core/package.json`, prepends `packages/core/CHANGELOG.md`, and deletes the consumed
  changeset files.
- Merge that PR when you want to release. The Action runs again, and with no pending changesets it
  builds, runs `check:exports`, and `changeset publish`es to npm with provenance, then tags.
No manual `npm version`, no hand-edited changelog, no `gh workflow run`: author a changeset, then
merge the "Version Packages" PR.
- Needs the `NPM_TOKEN` secret and the repo setting "Allow GitHub Actions to create and approve pull
  requests" (Settings -> Actions -> General).
- Core is at `0.2.0` (npm latest). Docs live at docs.bonnard.dev via the `bonnard-docs` repo (push
  its `main` to deploy on Vercel).
Publishing is deliberate: it only happens when you merge the Version Packages PR.

## Conventions
Comments: limited and refined, only when needed; clarify non-obvious behavior, don't narrate
decisions. Prefer clear names. No emojis, no em-dashes. Prose for humans (docs, READMEs, changelog,
marketing, UI copy): run the `house-voice` skill (house copy rules + removes AI writing tells,
accuracy first). Commit trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Sole-dev workflow: short-lived
branch -> review -> merge to `main` locally; no PRs.
