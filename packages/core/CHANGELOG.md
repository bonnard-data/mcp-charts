# Changelog

All notable changes to `@bonnard/mcp-charts` are documented here.

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
