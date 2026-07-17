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
