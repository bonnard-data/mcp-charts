---
"@bonnard/mcp-charts": minor
---

DashboardSpec + named-views authoring (explore_views / render_view) + single-cell rendering

Add a `DashboardSpec` contract (a grid of chart / KPI / text items) alongside the existing
`ChartSpec`, with `isDashboardSpec` / `isChartSpec` runtime guards. The embedded widget now renders
a `DashboardSpec` returned from any MCP tool: a responsive CSS grid of chart cells, KPI tiles (with
signed delta), and text blocks, with multi-instance ECharts teardown and theme re-render. New
`registerChartWidget` and `CHART_RESOURCE_URI` exports let a consumer serve the widget for its own
tool. Shared dashboard fixtures are published on the `@bonnard/mcp-charts/fixtures` subpath.

Add `addViews(server, { views })`: one authored entrypoint that registers `explore_views` (discover
the available views: id, title, description, kind, params) and `render_view` (render one by
`view_id`, validating per-view params) over a registry of named views. Each `ViewDef` returns a
`ChartSpec` or a `DashboardSpec`, so a view can be a single chart or a full dashboard, both bound to
the same widget. The authoring helpers `chart(rows, opts)`, `chartCell(rows, opts)`, and `explain`
build specs from raw rows or a typed `ChartData` (both infer the encoding via `resolve()`).
`dashboardResult`, `summarizeDashboard`, and `DASHBOARD_OUTPUT_SCHEMA` are exported for the manual
hand-registration path; the raw `DashboardSpec` route stays first-class.

Add single-cell rendering. `chartCell(..., { id })` and `ChartCell.id` give a dashboard cell a stable
id (`KpiTile.id` / `TextBlock.id` exist for uniform addressability; v1 selection renders chart cells
only). `render_view` gains an optional `item_id`: params always apply to the whole view, then the
named chart cell is projected out and returned as a standalone `ChartSpec`. Cell ids surface in the
dashboard summary (`[id: ...]` per chart line) and in the tool descriptions, and a bad `item_id`
error lists the selectable ids.
