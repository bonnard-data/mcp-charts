# Changelog

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
