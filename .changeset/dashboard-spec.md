---
"@bonnard/mcp-charts": minor
---

DashboardSpec + multi-chart dashboard rendering + fixtures export

Add a `DashboardSpec` contract (a grid of chart / KPI / text items) alongside the existing
`ChartSpec`, with `isDashboardSpec` / `isChartSpec` runtime guards. The embedded widget now renders
a `DashboardSpec` returned from any MCP tool: a responsive CSS grid of chart cells, KPI tiles (with
signed delta), and text blocks, with multi-instance ECharts teardown and theme re-render. New
`registerChartWidget` and `CHART_RESOURCE_URI` exports let a consumer serve the widget for its own
tool. Shared dashboard fixtures are published on the `@bonnard/mcp-charts/fixtures` subpath.

Also add dashboard authoring helpers that collapse the per-cell and per-tool boilerplate:
`chart(rows, opts)` builds a standalone `ChartSpec` from raw rows (the sibling of `chartCell`, which
wraps it in a dashboard cell), `chartCell(rows, opts)` builds a chart cell straight from raw rows
(both infer the encoding via `resolve()`), and `addDashboardTool(server, def, handler)` registers a
DashboardSpec-returning tool the same way `addCharts` registers `visualize` (widget resource,
outputSchema, `_meta` link, error handling). `dashboardResult`, `summarizeDashboard`, and
`DASHBOARD_OUTPUT_SCHEMA` are also exported for the manual path; the raw `DashboardSpec` route stays
first-class.

Add `addDashboardViews(server, { views })` for the multi-view case: a views registry (each `ViewDef`
returns a `ChartSpec` or `DashboardSpec`) surfaced as two tools. `explore_views` lists the available
views (id, title, description, kind, params) for discovery; `render_view` renders one by `view_id`
(validating per-view params) and binds the result to the chart widget. Handles both single-chart and
multi-item-dashboard views from one tool pair.
