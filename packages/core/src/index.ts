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
  KpiTile,
  TextBlock,
  ChartCell,
  DashboardItem,
  DashboardSpec,
} from "./types.js";

// Runtime guards: discriminate a DashboardSpec from a single ChartSpec.
export { isDashboardSpec, isChartSpec } from "./dashboard.js";

// The pure brain: ChartData -> ChartSpec.
export { resolve } from "./resolve/resolve.js";
export { inferFields } from "./resolve/infer.js";

// The server API: register the visualize tool(s).
export { addCharts } from "./charts.js";
export type { AddChartsOptions } from "./charts.js";

// Adapter authoring kit: turn a SQL result (rows + column types) into typed ChartData, plus the
// read-only backstop. Use these to write a runSql for any warehouse the bundled adapters don't cover.
export { buildChartData, defaultNormalizeCell, assertReadOnlySql } from "./adapters/sql.js";
export type { SourceColumn, KindMapper, CellNormalizer, BuildChartDataOptions } from "./adapters/sql.js";

// Engine adapters are opt-in subpaths so the core stays dependency-free:
//   import { bigQueryRunSql, bigQueryToChartData } from "@bonnard/mcp-charts/bigquery";
