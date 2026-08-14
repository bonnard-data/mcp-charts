// @bonnard/mcp-charts — add agent-ready charts to your MCP server.
//
// Public surface:
//   addCharts(server, options)   -> registers a generic `visualize` tool + the chart widget
//
// See ARCHITECTURE notes in the repo for the data flow (callback seam -> ChartData ->
// resolve() -> ui:// widget, cross-host Claude + ChatGPT).

export type {
  ChartData,
  ChartContext,
  ChartType,
  FieldMeta,
  FieldRole,
  FieldKind,
  FieldFormat,
  TimeGranularity,
  Encode,
  Stacking,
  ChartSpec,
  SeriesSpec,
  AxisSpec,
  ColumnSpec,
  ReferenceLine,
  ResolveOptions,
  ChartExplanation,
  Decision,
  DecisionAudience,
  DecisionKind,
  KpiTile,
  TextBlock,
  ChartCell,
  DashboardItem,
  DashboardSpec,
} from "./types.js";

// Runtime guards: discriminate a DashboardSpec from a single ChartSpec.
export { isDashboardSpec, isChartSpec } from "./dashboard.js";

// Named-views authoring: build cells/charts + register the two-tool surface (explore_views +
// render_view) over a set of named views, without the per-cell glue.
export {
  chart,
  chartCell,
  explain,
  dashboardResult,
  summarizeDashboard,
  DASHBOARD_OUTPUT_SCHEMA,
  addViews,
} from "./views.js";
export type { ChartOptions, ChartCellOptions, ViewDef, ViewResult, AddViewsOptions } from "./views.js";

// The pure brain: ChartData -> ChartSpec.
export { resolve } from "./resolve/resolve.js";
export { inferFields } from "./resolve/infer.js";

// The server API: register the visualize tool(s).
export { addCharts, registerChartWidget, CHART_RESOURCE_URI } from "./charts.js";
export type { AddChartsOptions } from "./charts.js";

// The widget HTML and its host metadata, so a downstream host can serve the same renderer directly
// (not only via the MCP resource) and reuse the widget-linking `_meta`.
export { WIDGET_HTML } from "./generated/widget-html.js";
export { WIDGET_META, VIEW_OUTPUT_SCHEMA } from "./views.js";

// Embed mode's wire contract, for a consumer driving `WIDGET_HTML#embed` over postMessage.
// See docs/EMBED-MODE.md.
export { EMBED_PROTOCOL_VERSION, EMBED_LIMITS } from "./embed.js";
export type {
  EmbedTokens,
  EmbedPayload,
  EmbedSizing,
  BonnardRenderMessage,
  BonnardReadyMessage,
  BonnardSizeMessage,
  BonnardContentSizeMessage,
  BonnardFillSizeMessage,
  BonnardErrorMessage,
  BonnardErrorCode,
  BonnardWidgetMessage,
  BonnardParentMessage,
} from "./embed.js";

// Adapter authoring kit: turn a SQL result (rows + column types) into typed ChartData, plus the
// read-only backstop. Use these to write a runSql for any warehouse the bundled adapters don't cover.
export { buildChartData, defaultNormalizeCell, assertReadOnlySql } from "./adapters/sql.js";
export type { SourceColumn, KindMapper, CellNormalizer, BuildChartDataOptions } from "./adapters/sql.js";

// Engine adapters are opt-in subpaths so the core stays dependency-free:
//   import { bigQueryRunSql, bigQueryToChartData } from "@bonnard/mcp-charts/bigquery";
