# Widget dev harness (hot-reloading render preview)

Iterate on the chart/dashboard renderer without the build -> embed -> restart cycle.

The harness is the dev-only cousin of [embed mode](./EMBED-MODE.md): same idea (a parent page drives the
widget over postMessage), but `#harness` and the `bonnard:harness-*` messages are internal and may change
without notice. Build against `#embed` and `bonnard:render` instead.

## One command

```bash
pnpm dev:harness           # from repo root  (or: pnpm -F @bonnard/mcp-charts-widget harness)
```

Opens `packages/widget/src/harness.html`: a control panel (left) driving the **real widget** in an
iframe (right). Pick an example, edit the `data`/`opts` JSON (or a raw spec), and the preview
updates live.

## What hot-reloads

The harness feeds the iframe exactly like a host delivers a tool result (`postMessage` ->
`main.ts`'s `#harness` hook). The spec is produced by core's `resolve()` imported **from source**, so:

- Edit the renderer (`main.ts`, `spec-to-option.ts`, `dashboard.ts`, `table.ts`) -> the iframe
  reloads and the harness re-feeds the current spec (it pings `bonnard:harness-ready` on load).
- Edit core inference (`resolve/*`, `infer.ts`, `validate.ts`) -> the panel re-`resolve()`s and re-feeds.

Two modes: **data + opts -> resolve()** (exercises inference + rendering, the production path) and
**raw spec** (feed a hand-written `ChartSpec`/`DashboardSpec` straight to the renderer). Light/dark
toggle drives the widget's `applyTheme`. Examples come from `packages/widget/test/fixtures.ts` (the
same fixtures that back the structural tests + visual PNGs — the harness is their gallery), plus an
assembled dashboard sample.

## Why it's safe to ship inert

`harness.html`/`harness.ts` live in `src/` but the production build's input is `src/index.html` only
(`vite.config.ts`), and `vite-plugin-singlefile` is gated to `command === "build"`. The harness is
never bundled into the embedded widget; the `#harness` hook in `main.ts` is gated on the URL
fragment (hosts load the resource without one) and is render-only.
