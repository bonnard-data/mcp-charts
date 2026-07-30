// Authoring ergonomics for the named-views surface: build chart cells without the
// buildChartData/resolve ceremony, wrap a DashboardSpec into the widget-linked tool result, and
// register the explore_views + render_view tool pair over a set of named views. The raw
// DashboardSpec path stays first-class — these just remove the per-cell boilerplate.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  ChartCell,
  ChartData,
  ChartExplanation,
  ChartSpec,
  DashboardSpec,
  Encode,
  FieldMeta,
  ResolveOptions,
} from "./types.js";
import { resolve } from "./resolve/resolve.js";
import { inferFields } from "./resolve/infer.js";
import { warnUntypedColumns } from "./validate.js";
import { isChartSpec, isDashboardSpec } from "./dashboard.js";
import { registerChartWidget, CHART_RESOURCE_URI } from "./charts.js";

// Link a tool + its result to the chart widget. `ui.resourceUri` is the MCP Apps standard (Claude,
// Cursor, Inspector); `openai/outputTemplate` is the ChatGPT Apps SDK alias. Same shape as visualize.
export const WIDGET_META = {
  ui: { resourceUri: CHART_RESOURCE_URI },
  "openai/outputTemplate": CHART_RESOURCE_URI,
} as const;

/** Extra per-cell options layered on top of resolve()'s options. */
export interface ChartCellOptions extends ResolveOptions {
  /** Stable id for addressing this cell via render_view's item_id (re-render one chart alone). */
  id?: string;
  /** Grid columns this cell spans (renderer clamps to the dashboard's column count). */
  span?: number;
  /** Declare field typing when inference can't nail it (currency, numeric-string dimensions). */
  fields?: FieldMeta[];
  /** Map columns to x / y / series when the names aren't obvious. */
  encode?: Encode;
}

/** Options for a standalone chart: resolve()'s options plus the field-typing / encoding escape hatches. */
export type ChartOptions = ResolveOptions & { fields?: FieldMeta[]; encode?: Encode };

/** Normalize the first arg of chart()/chartCell() into a ChartData. Raw rows (an array) become
 *  `{ rows }` + inferred fields; a typed ChartData (from an adapter) passes through unsniffed, with
 *  opts.fields/encode layering onto any it already declares. */
function toChartData(source: Record<string, unknown>[] | ChartData, opts: { fields?: FieldMeta[]; encode?: Encode }) {
  if (Array.isArray(source)) return { rows: source, fields: opts.fields, encode: opts.encode };
  return {
    rows: source.rows,
    fields: opts.fields ?? source.fields,
    encode: opts.encode ?? source.encode,
    notes: source.notes,
  };
}

// Merge integrator advisories (numbers-as-strings, wrapper objects) into a spec's notes, deduped.
// After numeric-string recovery these are "recovered" signals, so they surface on the views path
// the way visualize already surfaces them (visualize logs them itself; don't double up there).
function mergeAdvisories(spec: ChartSpec, data: ChartData): ChartSpec {
  const advisories = warnUntypedColumns(data);
  if (advisories.length === 0) return spec;
  const notes = [...(spec.notes ?? [])];
  for (const a of advisories) if (!notes.includes(a)) notes.push(a);
  return { ...spec, notes };
}

/**
 * Build a standalone ChartSpec, inferring the encoding via resolve(). The first arg is EITHER raw
 * rows (`Record<string, unknown>[]` — inference sniffs types) OR a typed `ChartData` (`{ rows,
 * fields?, encode?, notes? }` from an adapter — driver types are trusted, no sniff). For a
 * DB-connected view, `chart(await runSql("select ..."), { chartType: "line" })` is the same one
 * line but rides declared types. `fields`/`encode` are escape hatches for the raw path. The sibling
 * of chartCell, which wraps this spec in a dashboard cell.
 */
export function chart(source: Record<string, unknown>[] | ChartData, opts: ChartOptions = {}): ChartSpec {
  const { fields, encode, ...resolveOpts } = opts;
  const data = toChartData(source, { fields, encode });
  return mergeAdvisories(resolve(data, resolveOpts), data);
}

/**
 * Build a dashboard chart cell, inferring the encoding via resolve(). Like chart(), the first arg is
 * either raw rows or a typed `ChartData`. `fields`/`encode` are escape hatches; `span` sets the grid
 * width.
 */
export function chartCell(source: Record<string, unknown>[] | ChartData, opts: ChartCellOptions): ChartCell {
  const { id, span, ...chartOpts } = opts;
  return {
    spec: chart(source, chartOpts),
    ...(id ? { id } : {}),
    ...(span ? { span } : {}),
  };
}

/**
 * Diagnose how rows (or a typed ChartData) would be charted, WITHOUT building the render payload:
 * the inferred field typing, the resolved chartType / x / series, and any notes. For asserting the
 * encoding in a unit test or CI before a host ever renders it, e.g.
 * `expect(explain(sampleRows, { chartType: "bar" }).series.length).toBeGreaterThan(0)`. Pair with
 * `strict: true` to throw on a bad encoding (zero series, ignored encode column) instead of noting.
 */
export function explain(source: Record<string, unknown>[] | ChartData, opts: ChartOptions = {}): ChartExplanation {
  const { fields, encode, ...resolveOpts } = opts;
  const data = toChartData(source, { fields, encode });
  const spec = mergeAdvisories(resolve(data, resolveOpts), data);
  return {
    fields: inferFields(data).map((f) => ({ name: f.name, kind: f.kind!, role: f.role! })),
    chartType: spec.chartType,
    x: spec.x,
    series: spec.series.map((s) => s.key),
    notes: spec.notes ?? [],
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
      const id = item.id ? ` [id: ${item.id}]` : "";
      const notes = item.spec.notes?.length ? ` Note: ${item.spec.notes.join(" ")}` : "";
      lines.push(`- ${title}${id}: ${item.spec.chartType} chart, ${item.spec.data.length} row(s)${notes}`);
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

// render_view returns a ChartSpec, a DashboardSpec, or (with item_id) a single cell's ChartSpec, so
// its outputSchema must accept all three. DASHBOARD_OUTPUT_SCHEMA can't: it requires `items` and
// types `columns` as a number (a ChartSpec's `columns` is an array). A passthrough object still
// declares an outputSchema (so hosts forward structuredContent to the widget) but sets
// `additionalProperties` open, accepting any of the spec shapes.
export const VIEW_OUTPUT_SCHEMA = z.object({}).passthrough();

// --- Multi-view registry: one discovery tool (explore_views) + one execute tool (render_view)
// over a set of named views, each returning a ChartSpec or DashboardSpec. ---

/** What a view's render returns: a bare spec or one paired with a summary. */
export type ViewResult = ChartSpec | DashboardSpec | { spec: ChartSpec | DashboardSpec; summary?: string };

/** One named, renderable view in a views registry. */
export interface ViewDef {
  /** The render_view view_id enum value (snake/kebab, stable). */
  id: string;
  title: string;
  /** One line; shown in explore_views and the render_view catalog. */
  description: string;
  /** Optional author hint for the catalog. */
  kind?: "chart" | "dashboard";
  /** Per-view input params as a zod raw shape. */
  params?: Record<string, z.ZodTypeAny>;
  /**
   * Produce the view's spec(s). For a DB-connected view, return a typed `ChartData` so the encoding
   * rides driver types instead of a value sniff, e.g. `chart(await runSql("select ..."), { chartType:
   * "line" })` — `chart`/`chartCell` accept a `ChartData` anywhere they accept raw rows.
   */
  render: (args: Record<string, unknown>) => ViewResult | Promise<ViewResult>;
}

/** Options for addViews. */
export interface AddViewsOptions {
  views: ViewDef[];
  /** Override the discovery tool name (default: "explore_views"). */
  exploreToolName?: string;
  /** Override the execute tool name (default: "render_view"). */
  renderToolName?: string;
  /** Extra text appended to render_view's description. */
  renderDescription?: string;
}

/** A compact, bounded chart summary (the single-chart analogue of summarizeDashboard). Appends the
 *  chart's notes so encoding advisories (blank chart, coerced columns) reach the agent, not just the
 *  human looking at the widget. */
function chartSummary(spec: ChartSpec): string {
  const notes = spec.notes?.length ? ` Note: ${spec.notes.join(" ")}` : "";
  return `${spec.title ?? spec.chartType}: ${spec.chartType} chart, ${spec.data.length} row(s)${notes}`;
}

// Best-effort primitive type name across zod 3 (_def.typeName) and zod 4 (_zod.def.type), unwrapping
// optional/nullable/default wrappers to report the inner type (e.g. "enum", not "optional").
function zodTypeName(schema: z.ZodTypeAny): string {
  let s: unknown = schema;
  for (let i = 0; i < 5; i++) {
    const v4 = (s as { _zod?: { def?: { type?: string; innerType?: unknown } } })._zod?.def;
    const v3 = (s as { _def?: { typeName?: string; innerType?: unknown } })._def;
    const type = v4?.type ?? (v3?.typeName ? String(v3.typeName).replace(/^Zod/, "").toLowerCase() : undefined);
    if (type && type !== "optional" && type !== "nullable" && type !== "default") return type;
    const inner = v4?.innerType ?? v3?.innerType;
    if (!inner) break;
    s = inner;
  }
  return "unknown";
}

/** Best-effort {name,type,required} for a view's zod params, for the explore_views catalog. */
function describeParams(params?: Record<string, z.ZodTypeAny>): { name: string; type: string; required: boolean }[] {
  if (!params) return [];
  return Object.entries(params).map(([name, schema]) => ({
    name,
    type: zodTypeName(schema),
    required: !schema.isOptional(),
  }));
}

/** One catalog line per view: `` `id` (kind) — description. params: region?, ... ``. */
function catalogLine(view: ViewDef): string {
  const kind = view.kind ? ` (${view.kind})` : "";
  const params = describeParams(view.params);
  const paramList = params.length
    ? ` params: ${params.map((p) => `${p.name}${p.required ? "" : "?"}`).join(", ")}`
    : "";
  return `- \`${view.id}\`${kind} - ${view.description}.${paramList}`;
}

/** The widget-linked envelope for a single ChartSpec, shared by chart-kind views and selected cells. */
function chartResult(spec: ChartSpec, summary?: string) {
  return {
    content: [{ type: "text" as const, text: summary ?? chartSummary(spec) }],
    structuredContent: spec as unknown as Record<string, unknown>,
    _meta: WIDGET_META,
  };
}

/**
 * Register a two-tool named-views surface: `explore_views` (list the available views) and
 * `render_view` (render one, bound to the chart widget). Each view returns a ChartSpec or a
 * DashboardSpec. Owns the widget resource, the outputSchema, the _meta link, param validation, the
 * result envelope, and error handling.
 */
export function addViews(server: McpServer, opts: AddViewsOptions): void {
  const { views } = opts;
  if (!views.length) throw new Error("addViews: `views` must be non-empty");
  const ids = views.map((v) => v.id);
  const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dupe) throw new Error(`addViews: duplicate view id "${dupe}"`);

  registerChartWidget(server);

  const byId = new Map(views.map((v) => [v.id, v]));
  const catalog = views.map(catalogLine).join("\n");

  const exploreName = opts.exploreToolName ?? "explore_views";
  const renderName = opts.renderToolName ?? "render_view";

  const itemIdSentence =
    `For dashboard views, pass item_id to re-render a single chart cell by its id ` +
    `(ids appear in the dashboard summary).`;

  server.registerTool(
    exploreName,
    {
      title: "Explore views",
      description:
        `List the available views (id, title, description, params). Call this first to ` +
        `discover what you can render, then call \`${renderName}\` with a chosen view_id. ` +
        itemIdSentence,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => {
      const structuredViews = views.map((v) => ({
        id: v.id,
        title: v.title,
        description: v.description,
        ...(v.kind && { kind: v.kind }),
        params: describeParams(v.params),
      }));
      return {
        content: [{ type: "text" as const, text: `Available views:\n${catalog}` }],
        structuredContent: { views: structuredViews },
      };
    },
  );

  const renderDescription =
    `Render one view by view_id, returning a chart or dashboard bound to the widget. ` +
    `${itemIdSentence} ` +
    `Available views:\n${catalog}` +
    (opts.renderDescription ? `\n\n${opts.renderDescription}` : "");

  server.registerTool(
    renderName,
    {
      title: "Render view",
      description: renderDescription,
      inputSchema: {
        view_id: z.enum(ids as [string, ...string[]]),
        params: z.record(z.string(), z.unknown()).optional(),
        item_id: z.string().optional(),
      },
      outputSchema: VIEW_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: WIDGET_META,
    },
    async (args: Record<string, unknown>) => {
      const viewId = String(args.view_id);
      const itemId = args.item_id != null ? String(args.item_id) : undefined;
      const view = byId.get(viewId);
      if (!view) {
        return { isError: true, content: [{ type: "text" as const, text: `${renderName}: unknown view "${viewId}"` }] };
      }
      try {
        let renderArgs: Record<string, unknown> = {};
        if (view.params) {
          const parsed = z
            .object(view.params)
            .strict()
            .safeParse(args.params ?? {});
          if (!parsed.success) {
            const issue = parsed.error.issues[0];
            const path = issue?.path.join(".") || "params";
            return {
              isError: true,
              content: [{ type: "text" as const, text: `${renderName}: invalid param "${path}": ${issue?.message}` }],
            };
          }
          renderArgs = parsed.data;
        }
        const out = await view.render(renderArgs);
        const { spec, summary } = "spec" in out ? out : { spec: out, summary: undefined };

        if (itemId != null) {
          const err = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });
          if (isChartSpec(spec)) {
            return err(`${renderName}: view "${viewId}" is a single chart; item_id does not apply`);
          }
          if (!isDashboardSpec(spec)) {
            throw new Error("view render returned neither a ChartSpec nor a DashboardSpec");
          }
          const matches = spec.items.filter((it) => "id" in it && it.id === itemId);
          if (matches.length === 0) {
            const chartIds = spec.items.flatMap((it) => ("spec" in it && it.id ? [it.id] : []));
            const tail = chartIds.length
              ? ` Selectable chart cells: ${chartIds.map((c) => `"${c}"`).join(", ")}`
              : ` This view has no items with ids; add id to chartCell(...) to enable item selection`;
            return err(`${renderName}: unknown item_id "${itemId}" for view "${viewId}".${tail}`);
          }
          if (matches.length > 1) {
            return err(`${renderName}: duplicate item id "${itemId}" in view "${viewId}"`);
          }
          const item = matches[0]!;
          if (!("spec" in item)) {
            const kind = "type" in item && item.type === "text" ? "text block" : "kpi tile";
            return err(
              `${renderName}: item "${itemId}" in view "${viewId}" is a ${kind}, not a chart; only chart cells render alone`,
            );
          }
          return chartResult(item.spec);
        }

        if (isDashboardSpec(spec)) return dashboardResult(spec, { summary });
        if (isChartSpec(spec)) return chartResult(spec, summary);
        throw new Error("view render returned neither a ChartSpec nor a DashboardSpec");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text" as const, text: `${renderName} failed: ${message}` }] };
      }
    },
  );
}
