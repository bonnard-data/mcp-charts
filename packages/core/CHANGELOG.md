# Changelog

## 0.4.1

### Patch Changes

- 95056c9: Remove the `newRow` tile-placement marker. Its CSS rule collided with a tile's `span`: `grid-column: span N` shorthand lives in `grid-column-start`, so `newRow`'s `grid-column-start: 1` clobbered the span instead of composing with it, collapsing any tile combining `span` and `newRow` to 1-column width.

## 0.4.0

### Minor Changes

- 7c8d8cd: Render markdown in text tiles. Bold, italic, lists, links, and headers in a text tile's body now render as formatted output instead of literal markdown syntax. Raw HTML in the source is never passed through, so this is safe for LLM-authored or end-user-typed content.
- 70345d6: Add an optional `newRow` marker on a dashboard tile. Setting it forces that tile to start a fresh grid row instead of wrapping into leftover space in the current row, giving explicit control over row breaks instead of relying on emergent auto-flow.

### Patch Changes

- 5148a47: Fix table tiles overflowing their cell instead of scrolling. A table with more rows than fit now scrolls internally with a sticky header instead of growing the card unbounded; a table wider than its cell scrolls horizontally instead of clipping at the edge. Also stop short cells (a small table, a KPI) from being stretched to match a taller chart neighbor in the same grid row.

## 0.3.2

### Patch Changes

- df4ea47: Bars stay vertical unless you ask for horizontal, and short frames no longer clip x-axis labels.

  **Bar charts no longer flip themselves horizontal.** `resolve()` used to switch any categorical bar
  chart with more than 8 rows to a horizontal layout. A row count is a poor stand-in for the thing that
  actually makes a flip worthwhile, which is label width: the rule turned twelve `Q1`-sized labels
  sideways while leaving five 40-character labels alone. It also sent a 12-month series sideways, which
  is what prompted this change. Bars now default to vertical, matching Superset, Metabase, Lightdash and
  Evidence, none of which infer orientation from row count.

  `horizontal: true` is the explicit opt-in and works exactly as before, on both the `chart` tool schema
  and a hand-written `ChartSpec`. The option now carries a description so a model calling the tool can
  find it. A same-axis combo line still forces a vertical layout, since a connected line over horizontal
  bars reads as a meaningless diagonal.

  If you relied on the automatic flip, add `horizontal: true`. Saved specs are worth a look before you
  upgrade: none of them recorded `horizontal: false`, because vertical was never something you had to
  ask for, so any chart that used to flip now renders vertical. Long category labels are still handled
  without a flip request. The widget keeps its own label-width rule, which flips a bar chart when the
  labels themselves are too long to sit under vertical bars, and otherwise thins overlapping ticks so
  the ones it draws stay readable.

  **Fill-mode charts no longer clip their x-axis labels in a short frame.** The single-cell embed shapes
  carried a `min-height: 240px` floor, so a frame shorter than that overflowed instead of shrinking and
  the bottom row of tick labels was cut off. Measured in Chrome at a 654x228 frame, the chart held 240px
  and the labels ran to 232.7px, past the edge. Without the floor the chart tracks the frame at 180px,
  228px and 300px and the labels clear the bottom by 7px. An unsized iframe still has its 150px intrinsic
  height, so nothing depended on the floor to stay visible. Dashboard grid cells keep their own 240px
  minimum.

## 0.3.1

### Patch Changes

- a43352f: Fix embed mode: loop-safe sizing, real token validation, and a contract that fails closed.

  Two independent reviews of the 0.3.0 embed surface found problems worth fixing before the API
  hardens into a semver obligation. Nothing here changes the MCP host path.

  **Embed mode no longer starts the MCP Apps bridge.** In `#embed` the widget previously still
  constructed the ext-apps `App` and posted a `ui/initialize` request to the parent. An embedding page
  does not answer that, and a page that _did_ answer it got a second, undocumented resize protocol
  competing with `bonnard:size`. Embed setup is now fully synchronous and self-contained: the
  `data-embed` attribute, the first paint, and `bonnard:ready` all happen in one turn, sequenced behind
  nothing. Outside embed mode the bridge behaves exactly as before.

  **Sizing is now structurally loop-safe, and a fill chart can no longer be left collapsed.** The widget
  tracks `sizing: "fill" | "content"` per payload, and every `bonnard:size` message carries that
  discriminant.

  - `sizing: "content"` (KPI, text, table, fallback) carries a measured `height` to apply.
  - `sizing: "fill"` (charts) carries `height: null` and means _release any height you applied for this
    frame_, since only the parent can decide a chart's height. No measured height is ever reported for a
    fill payload, so there is no value to feed back.

  In content mode `html`, `body`, and `#root` stay at `height: auto`, so a measurement cannot depend on
  the height you just applied: there is no loop to converge.

  The release message closes a collapse trap that 0.3.0's own documented handler walked straight into.
  The pre-render "waiting for chart data" placeholder is content-shaped, so it reported roughly 48px; a
  parent applying that shrank the frame; the fill chart then filled 48px permanently, because a fill
  payload reported nothing and so never told the parent to let go. Two changes fix it: the widget stays
  silent until a payload has actually rendered (the placeholder's height says nothing about the payload
  to come), and entering fill mode is announced explicitly.

  **Breaking-ish note for anyone who adopted 0.3.0's embed handler:** branch on `sizing` rather than
  applying `height` unconditionally. The docs, README, and `examples/embed/` now all show the branching
  form, and giving the frame its height from a sized container via a stylesheet rule (rather than an
  inline style) is what lets a release fall back to your layout height. Applying `height` blindly is now
  harmless rather than destructive, since the fill message's `height` is `null`, but it will not restore
  the frame.

  **Token validation is by property grammar, not a denylist.** The old check only rejected a literal
  `url(`, but CSS function names accept escapes, so `u\72l(https://…)` slipped through and landed in
  the broad `background` property, contradicting the "no network requests" claim. Colour tokens must now
  satisfy a strict colour grammar (hex, a short keyword list, or a numeric colour function) and are
  applied via `background-color`; `fontFamily` has a conservative font-list grammar. Escapes,
  `image-set()`, gradients, `var()`, `attr()`, comments, control characters, and newlines are all
  rejected. The widget also ships a restrictive `Content-Security-Policy` as defence in depth.

  **The widget authenticates the sender.** Embed messages are only accepted when `event.source` is the
  frame's own parent, which needs no `allow-same-origin`. The docs previously said the frame could not
  verify the sender; it cannot verify your _origin_, but it can and now does verify identity.

  **The two mode dialects are separate.** `#embed` accepts only `bonnard:render`, and `#harness` only
  `bonnard:harness-render`. This restores the "harness unchanged" guarantee and stops the internal
  dialect being reachable from the public surface.

  **Payloads are validated with caps.** `{items:[null]}` used to throw, `{type:"text"}` rendered
  "undefined", and `{data:[{}]}` passed as a chart. Payloads are now structurally validated with bounds
  on rows, items, series/columns, string length, notes, and nesting depth (exported as `EMBED_LIMITS`).
  A refusal returns a typed `bonnard:error` (`code`, `message`, and your `renderId`) instead of throwing
  from the message listener, and leaves whatever was on screen intact. ECharts instances are recorded
  before `setOption`, so a throw can no longer leak one.

  **Cell selection fails closed, and accepts `itemId`.** A negative, non-integer, wrong-typed, or
  out-of-range `item` used to fall back to rendering the whole dashboard, spilling other cells into the
  caller's layout. Those now return `bonnard:error` and draw nothing. Items already carry stable ids, so
  `itemId` is the preferred selector; the numeric index remains as a convenience.

  **`titled=true` now works for every single-cell shape.** Previously only a top-level non-table
  `ChartSpec` honoured it; a table, a bare chart cell, and a dashboard cell selected by `item` ignored
  it. Single-cell title composition is centralized, and the title means the rendered cell's own chart
  title.

  **Theme precedence is defined.** The `#embed` fragment provides the initial theme; the most recent
  valid `theme` on a render message becomes a persistent explicit override that a later host or OS
  change will not revert; host and OS apply only when neither exists.

  **The protocol surface is exported.** `EmbedTokens`, `EmbedPayload`, `EmbedSizing`,
  `BonnardRenderMessage`, `BonnardReadyMessage`, `BonnardSizeMessage` (a union of
  `BonnardContentSizeMessage` and `BonnardFillSizeMessage`), `BonnardErrorMessage`, `BonnardErrorCode`,
  `BonnardWidgetMessage`, `BonnardParentMessage`, `EMBED_PROTOCOL_VERSION`, and `EMBED_LIMITS` now come
  from `@bonnard/mcp-charts`, so TypeScript consumers stop hand-copying types out of the docs. Narrowing
  `BonnardSizeMessage` on `sizing` gives you the right `height` type for free: `number` or `null`.

  **What tokens actually theme, stated plainly.** Tokens theme the HTML surface only: page background,
  body text, table rules, tiles, and notes. They do **not** theme ECharts axes, gridlines, legend,
  tooltip, series palette, or chart text, which follow `theme: "light" | "dark"` and are otherwise
  fixed. The public token surface is narrowed to what works: the `grid` token is removed, since no CSS
  consumed it, and `fontFamily` is now a CSS custom property (`--font-family`) rather than a plain
  property, matching the documented behaviour. Wiring chart theming is left as a documented future
  addition rather than implied by the token list.

  **Correcting the record on 0.3.0's "purely additive" claim.** That claim does not hold and is
  withdrawn. 0.3.0 began clearing the widget's remembered payload after a fallback or invalid input on
  every surface, not only in embed mode: before 0.3.0, a valid chart followed by a fallback would
  repaint the _old_ chart on a later theme change, whereas from 0.3.0 it keeps the fallback. That is a
  reasonable fix and it is retained here, but it is observable outside embed mode and should have been
  disclosed as a behaviour change rather than described as additive. 0.3.0 also let `#embed` accept the
  internal `bonnard:harness-render` dialect and `#harness` accept `bonnard:render`; both are corrected
  above.

  Also: real browser integration tests now drive the built widget inside an opaque
  `sandbox="allow-scripts"` iframe, covering ready timing and ordering, the `data-embed` activation,
  source filtering, malformed payloads, theme precedence, token attacks, fill-versus-content sizing with
  a convergence bound, the collapse sequence above (including under 0.3.0's naive handler), and the
  inertness of the no-fragment and `#harness` paths. The previous suite only exercised the helpers, which
  is why the issues above shipped.

  One testing note, since it looks like a bug and is not: Chrome throttles `requestAnimationFrame` for
  offscreen cross-origin iframes, and the size reporter is rAF-coalesced, so a frame scrolled out of view
  may report no size at all until it becomes visible. Test embed sizing with the frame on screen.

  Known gaps, documented in `docs/EMBED-MODE.md`: chart theming, `notes=garbage` reading as off,
  unspecified fragment-parsing details (duplicate keys, case, percent-encoding), the 240px minimum being
  unable to resize an unsized iframe, and `protocolVersion` not yet being load-bearing.

## 0.3.0

### Minor Changes

- d912016: Add embed mode: render a single chart, KPI, or table inside your own UI, not only inside an MCP host.

  Point an iframe at `WIDGET_HTML` with an `#embed` fragment, then post a `bonnard:render` message carrying a `ChartSpec`, a bare `DashboardItem`, or a `DashboardSpec` with `item: n` to select one cell. Embed mode drops the widget's own padding, cell chrome, and title. Charts fill the container you give them; KPI, text, and table cells report their content height over `bonnard:size` so you can fit the frame to them. Presentation flags (`titled`, `theme`, `notes`) ride on the fragment, and theming goes through a bounded, validated token set rather than CSS overrides.

  Purely additive. The MCP resource path and every existing message behave identically, `sandbox="allow-scripts"` is still all the widget needs, and nothing changes for a consumer that does not opt in. See `docs/EMBED-MODE.md` for the flags, messages, tokens, and the stability contract.

## 0.2.1

### Patch Changes

- f8c90d4: Export `WIDGET_HTML`, `WIDGET_META`, and `VIEW_OUTPUT_SCHEMA` from the package root. A downstream host can now serve the same widget renderer directly (not only through the MCP resource) and reuse the widget-linking `_meta` and output schema without maintaining its own copies.

All notable changes to `@bonnard/mcp-charts` are documented here.

## 0.2.0

### Added

- Dashboards and named views. Return a `DashboardSpec` (a grid of KPI tiles, charts, and text), and register a set of named views behind `explore_views` / `render_view` with `addViews`. A view returns a single chart or a full dashboard, and `render_view` can render one cell of a dashboard by `item_id`.
- Inference guardrails and a typed-data path, so mistakes on live, unseen data stop failing silently: numeric-string recovery, zero-series notes, `explain()` / `strict` for CI, and a typed `chart(ChartData)` overload.
- `mcp-charts preview` CLI. Render a saved spec file or a live tool result in the real chart widget from your terminal, so your preview matches what Claude and ChatGPT render.

### Changed

- Consolidated the authored surface onto `addViews`, and removed the single-dashboard `addDashboardTool` (it was never released).

## 0.1.3

### Added

- Scatter/bubble charts can group by category: `encode.series` splits the point cloud into one colored series per category, with a legend. Previously it was ignored and every point rendered the same color.
- `encode.line` is additive: a measure drawn as a line no longer has to also be listed in `y`. `x` / `y` / `line` each name their own column, matching how `y2` already worked. Naming a line measure absent from `y` previously drew nothing, silently.

### Fixed

- Tables render exact numbers with separators (`1,234,567`) instead of the chart-style abbreviation (`1.2M`). Charts and axes still abbreviate.
- Multi-series charts no longer mis-sum a category literally named `constructor` / `toString` / `valueOf` (a prototype-chain collision in the pivot).
- Stacked 100% charts exclude a combo (`type:line`) overlay from the 100% total, so the real series' shares are no longer shrunk.

### Changed

- The resolver reports its decisions through chart notes instead of failing silently: an unknown `encode` column (with the available columns listed), a `y2` measure dropped when the chart is also split into series, summing a rate/percent column across duplicate rows, and a waterfall defaulting the first/last rows to totals all now surface a note. Notes, not errors: it renders what it can and explains the gap.
- The `visualize` tool's `line` parameter description no longer instructs the agent to duplicate the column into `y`.

## 0.1.2

- Column type-inference fixes so numeric and temporal columns from drivers that string-encode values (Postgres `NUMERIC`/`BIGINT`, `DATE`/`TIMESTAMP`, and the equivalents across BigQuery/ClickHouse/DuckDB) chart correctly instead of collapsing to blank or nonsense.
- Dev-facing warning when a column arrives untyped and looks mis-inferrable.
- Permissive `outputSchema` on the `visualize` tool so hosts forward `structuredContent` to the widget.
- Docs and quickstart lead with the typed warehouse adapter (`postgresRunSql(pool)`).
