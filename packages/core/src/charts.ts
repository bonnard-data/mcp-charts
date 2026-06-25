// addCharts — register the agent-facing visualize tool + chart widget, call the dev's data
// callback, run resolve() server-side, and return a ChartSpec linked to the ui:// widget.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ChartContext, ChartData, ChartSpec, ChartType, Encode } from "./types.js";
import { resolve } from "./resolve/resolve.js";
import { validateRowsShape, assertPlottedScalar } from "./validate.js";
import { WIDGET_HTML } from "./generated/widget-html.js";

const ALL_CHART_TYPES: ChartType[] = ["line", "bar", "area", "pie", "scatter", "funnel", "waterfall", "table"];

// MCP Apps: the widget is served as a ui:// resource; the tool links to it via _meta.
const CHART_RESOURCE_URI = "ui://bonnard/chart";
const APP_MIME_TYPE = "text/html;profile=mcp-app";

/** Options for addCharts. */
export interface AddChartsOptions {
  /** SQL mode: the agent writes SQL; you execute it read-only and return rows. */
  runSql?: (sql: string, ctx: ChartContext) => Promise<ChartData>;
  /** Which chart types the agent may use (default: all). */
  allow?: ChartType[];
  /** Names the dev's schema-discovery tool so the agent is told to call it first. */
  discovery?: { toolName: string };
  /** Override the tool name (default: "visualize"). */
  toolName?: string;
}

/** Presentation inputs shared by every chart. */
function presentationInput(allow: ChartType[]): Record<string, z.ZodTypeAny> {
  return {
    chartType: z
      .enum(allow as [ChartType, ...ChartType[]])
      .optional()
      .describe(
        "Chart type. Omit to auto-detect from the data shape. For waterfall, return ordered steps " +
          "where the value is a SIGNED change (+ gain, − loss) and the start/end rows are totals.",
      ),
    title: z.string().optional().describe("Chart title"),
    stacking: z.enum(["stacked", "grouped", "stacked100"]).optional(),
    horizontal: z.boolean().optional(),
    reference: z
      .object({
        target: z.number().optional().describe("Draw a horizontal target/threshold line at this value"),
        average: z.boolean().optional().describe("Draw a line at the average of the primary series"),
      })
      .optional()
      .describe("Reference lines on the value axis (target and/or average)"),
    encode: z
      .object({
        x: z.string().optional(),
        y: z.union([z.string(), z.array(z.string())]).optional(),
        series: z.string().optional(),
        y2: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe("Measure(s) for a secondary right axis, drawn as a line (e.g. a % over $ bars)"),
        line: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            "Measure(s) to draw as a line instead of bars on the same axis (e.g. actual bars + target/forecast/moving-average line). Compute that measure in SQL, include it in y, and name it here.",
          ),
        size: z
          .string()
          .optional()
          .describe("Scatter only: a 3rd numeric column mapped to point size (makes a bubble chart)"),
      })
      .optional()
      .describe("Map columns to x / y / series / y2 when names aren't obvious"),
  };
}

// The widget renders from structuredContent; the text is just a fallback + a peek for the agent.
// Echo only a sample of the rows so a large result doesn't flood the model context (the full
// dataset is already in structuredContent for the chart).
const ECHO_SAMPLE = 50;

/** Build the CallToolResult: ChartSpec as structuredContent + a text fallback with the data. */
function buildResult(spec: ChartSpec) {
  const head =
    `${spec.chartType} chart${spec.title ? ` "${spec.title}"` : ""}: ` +
    `${spec.data.length} row(s), x=${spec.x || "(none)"}, series=[${spec.series.map((s) => s.key).join(", ")}]`;
  const notes = spec.notes?.length ? `\nNote: ${spec.notes.join(" ")}` : "";
  const truncated = spec.data.length > ECHO_SAMPLE;
  const sample = truncated ? spec.data.slice(0, ECHO_SAMPLE) : spec.data;
  const sampleNote = truncated
    ? `\n(text shows the first ${ECHO_SAMPLE} of ${spec.data.length} rows; the chart has all of them)`
    : "";
  return {
    content: [{ type: "text" as const, text: `${head}${notes}${sampleNote}\n${JSON.stringify(sample)}` }],
    structuredContent: spec as unknown as Record<string, unknown>,
  };
}

/** A clean "no rows" result — not an error; renders an empty chart, not a broken one. */
function emptyResult(title?: string) {
  const spec: ChartSpec = {
    chartType: "table",
    data: [],
    x: "",
    series: [],
    legend: false,
    ...(title && { title }),
    columns: [],
  };
  return {
    content: [{ type: "text" as const, text: `No rows returned${title ? ` for "${title}"` : ""} — nothing to chart.` }],
    structuredContent: spec as unknown as Record<string, unknown>,
  };
}

// Register the ui:// widget resource once per server (addCharts may be called repeatedly).
const widgetRegistered = new WeakSet<object>();
function registerWidgetResource(server: McpServer): void {
  if (widgetRegistered.has(server)) return;
  widgetRegistered.add(server);
  server.registerResource(
    "Bonnard Chart",
    CHART_RESOURCE_URI,
    { description: "Interactive chart widget", mimeType: APP_MIME_TYPE },
    () => ({
      contents: [{ uri: CHART_RESOURCE_URI, mimeType: APP_MIME_TYPE, text: WIDGET_HTML }],
    }),
  );
}

/** Register the generic `visualize` tool on an MCP server. */
export function addCharts(server: McpServer, options: AddChartsOptions): void {
  const allow = options.allow ?? ALL_CHART_TYPES;

  const { runSql } = options;
  if (!runSql) {
    throw new Error("addCharts: provide a data source (e.g. { runSql })");
  }

  const disc = options.discovery?.toolName
    ? ` First call \`${options.discovery.toolName}\` to discover tables and columns.`
    : "";
  const description =
    "Render an interactive chart from a read-only SQL SELECT." +
    disc +
    " Alias columns clearly. Omit chartType to auto-detect; pass `encode` to map columns" +
    " to x / y / series when the names aren't obvious.";

  const inputSchema = {
    sql: z.string().describe("A single read-only SQL SELECT statement"),
    ...presentationInput(allow),
  };

  // Register the chart widget as a ui:// resource (MCP Apps). Idempotent across calls.
  registerWidgetResource(server);

  server.registerTool(
    options.toolName ?? "visualize",
    {
      title: "Visualize",
      description,
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
      // Link the tool to its widget. `ui.resourceUri` is the MCP Apps standard (Claude,
      // Cursor, Inspector); `openai/outputTemplate` is the ChatGPT Apps SDK alias.
      _meta: {
        ui: { resourceUri: CHART_RESOURCE_URI },
        "openai/outputTemplate": CHART_RESOURCE_URI,
      },
    },
    async (args: Record<string, unknown>) => {
      const ctx: ChartContext = {};
      try {
        const data = await runSql(String(args.sql), ctx);
        validateRowsShape(data.rows); // fail loud on a wrong shape (not array / not objects)
        const title = args.title as string | undefined;
        if (data.rows.length === 0) return emptyResult(title); // friendly "no rows" state
        if (args.encode) data.encode = { ...(data.encode ?? {}), ...(args.encode as Encode) };
        const spec = resolve(data, {
          chartType: args.chartType as ChartType | undefined,
          title,
          stacking: args.stacking as ChartSpec["stacking"],
          horizontal: args.horizontal as boolean | undefined,
          reference: args.reference as { target?: number; average?: boolean } | undefined,
        });
        assertPlottedScalar(spec); // every plotted column must be scalar
        return buildResult(spec);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `visualize failed: ${message}` }],
        };
      }
    },
  );
}
