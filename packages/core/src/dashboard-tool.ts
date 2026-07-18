// Dashboard authoring ergonomics: build chart cells without the buildChartData/resolve ceremony,
// wrap a DashboardSpec into the widget-linked tool result, and register a dashboard tool the same
// way addCharts registers `visualize`. The raw DashboardSpec path stays first-class — these just
// remove the per-cell and per-tool boilerplate the example used to hand-write.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ChartCell, DashboardSpec, Encode, FieldMeta, ResolveOptions } from "./types.js";
import { resolve } from "./resolve/resolve.js";
import { registerChartWidget, CHART_RESOURCE_URI } from "./charts.js";

// Link a tool + its result to the chart widget. `ui.resourceUri` is the MCP Apps standard (Claude,
// Cursor, Inspector); `openai/outputTemplate` is the ChatGPT Apps SDK alias. Same shape as visualize.
const WIDGET_META = {
  ui: { resourceUri: CHART_RESOURCE_URI },
  "openai/outputTemplate": CHART_RESOURCE_URI,
} as const;

/** Extra per-cell options layered on top of resolve()'s options. */
export interface ChartCellOptions extends ResolveOptions {
  /** Grid columns this cell spans (renderer clamps to the dashboard's column count). */
  span?: number;
  /** Declare field typing when inference can't nail it (currency, numeric-string dimensions). */
  fields?: FieldMeta[];
  /** Map columns to x / y / series when the names aren't obvious. */
  encode?: Encode;
}

/**
 * Build a dashboard chart cell from raw rows, inferring the encoding via resolve(). `fields` and
 * `encode` are escape hatches for cases inference can't nail; `span` sets the grid width.
 */
export function chartCell(rows: Record<string, unknown>[], opts: ChartCellOptions): ChartCell {
  const { span, fields, encode, ...resolveOpts } = opts;
  return {
    spec: resolve({ rows, fields, encode }, resolveOpts),
    ...(span ? { span } : {}),
  };
}

/** A compact, bounded text summary of a dashboard for the model + a non-widget fallback. One line
 *  per item (KPI value/delta, chart title/type/row-count, text heading) — never echoes chart rows. */
export function summarizeDashboard(spec: DashboardSpec): string {
  const lines: string[] = [spec.title ?? "Dashboard"];
  for (const item of spec.items) {
    if ("type" in item && item.type === "kpi") {
      const delta = item.delta != null ? ` (Δ ${item.delta})` : "";
      lines.push(`- ${item.label}: ${item.value ?? "—"}${delta}`);
    } else if ("type" in item && item.type === "text") {
      if (item.heading) lines.push(`- ${item.heading}`);
    } else if ("spec" in item) {
      const title = item.spec.title ?? item.spec.chartType;
      lines.push(`- ${title}: ${item.spec.chartType} chart, ${item.spec.data.length} row(s)`);
    }
  }
  if (spec.notes?.length) lines.push(`Note: ${spec.notes.join(" ")}`);
  return lines.join("\n");
}

/** The DashboardSpec envelope: structuredContent for the widget + a text fallback + the widget link.
 *  Absorbs the structuredContent cast so callers never write it. */
export function dashboardResult(spec: DashboardSpec, opts?: { summary?: string | ((s: DashboardSpec) => string) }) {
  const text = typeof opts?.summary === "function" ? opts.summary(spec) : (opts?.summary ?? summarizeDashboard(spec));
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: spec as unknown as Record<string, unknown>,
    _meta: WIDGET_META,
  };
}

// Permissive outputSchema for the DashboardSpec envelope, mirroring visualize's in charts.ts: some
// hosts only forward structuredContent to the widget when the tool declares an outputSchema, and
// nested items stay open records so a valid spec is never rejected. Exported once so it can't drift.
export const DASHBOARD_OUTPUT_SCHEMA = {
  title: z.string().optional(),
  columns: z.number().optional(),
  items: z.array(z.record(z.string(), z.unknown())),
  notes: z.array(z.string()).optional(),
};

/** Definition for a dashboard tool. `inputSchema` is a zod raw shape, like registerTool expects. */
export interface DashboardToolDef {
  name: string;
  description: string;
  title?: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
}

/** What a dashboard handler returns: a bare DashboardSpec (the common case) or one with a summary. */
export type DashboardHandlerResult = DashboardSpec | { spec: DashboardSpec; summary?: string };

/**
 * Register a tool that returns a DashboardSpec, wiring the chart widget the same way addCharts wires
 * `visualize`. The handler returns a DashboardSpec (or `{ spec, summary }`); this owns the widget
 * resource, the outputSchema, the _meta link, the result envelope, and error handling.
 */
export function addDashboardTool<Args extends Record<string, unknown>>(
  server: McpServer,
  def: DashboardToolDef,
  handler: (args: Args) => DashboardHandlerResult | Promise<DashboardHandlerResult>,
): void {
  registerChartWidget(server);

  server.registerTool(
    def.name,
    {
      ...(def.title && { title: def.title }),
      description: def.description,
      ...(def.inputSchema && { inputSchema: def.inputSchema }),
      outputSchema: DASHBOARD_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: WIDGET_META,
    },
    async (args: Record<string, unknown>) => {
      try {
        const out = await handler(args as Args);
        const { spec, summary } = "spec" in out ? out : { spec: out, summary: undefined };
        return dashboardResult(spec, { summary });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `${def.name} failed: ${message}` }],
        };
      }
    },
  );
}
