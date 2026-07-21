// Multi-view registry: chart() parity with chartCell, and addViews driven through a real
// in-memory MCP Client (explore_views discovery + render_view execute, param validation, guards).
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { chart, chartCell, addViews, type ViewDef } from "../src/views.js";
import { resolve } from "../src/resolve/resolve.js";
import { isChartSpec, isDashboardSpec } from "../src/dashboard.js";

const MONTHLY = [
  { month: "2026-01-01", revenue: 42000 },
  { month: "2026-02-01", revenue: 38500 },
  { month: "2026-03-01", revenue: 51200 },
];
const BY_REGION = [
  { region: "EU", revenue: 128900 },
  { region: "US", revenue: 142300 },
  { region: "APAC", revenue: 65600 },
];

describe("chart", () => {
  it("returns a standalone ChartSpec passing isChartSpec", () => {
    const spec = chart(MONTHLY, { chartType: "line", title: "Revenue by month" });
    expect(isChartSpec(spec)).toBe(true);
    expect(spec).toEqual(resolve({ rows: MONTHLY }, { chartType: "line", title: "Revenue by month" }));
  });

  it("chartCell reuses chart: its spec equals chart(...) and it carries span", () => {
    const cell = chartCell(MONTHLY, { chartType: "line", title: "Revenue by month", span: 2 });
    expect(cell.spec).toEqual(chart(MONTHLY, { chartType: "line", title: "Revenue by month" }));
    expect(cell.span).toBe(2);
  });
});

const VIEWS: ViewDef[] = [
  {
    id: "sales_overview",
    title: "Sales overview",
    description: "KPIs + charts",
    kind: "dashboard",
    params: { region: z.enum(["EU", "US", "APAC"]).optional() },
    render: (args) => {
      const region = args.region as string | undefined;
      const rows = region ? BY_REGION.filter((r) => r.region === region) : BY_REGION;
      const total = rows.reduce((a, r) => a + r.revenue, 0);
      const spec: DashboardShape = {
        title: region ? `Sales (${region})` : "Sales",
        columns: 2,
        items: [
          { type: "kpi", id: "total_rev", label: "Total", value: total },
          chartCell(rows, { chartType: "bar", title: "By region", id: "by_region" }),
        ],
      };
      return spec;
    },
  },
  {
    id: "exec_summary",
    title: "Exec",
    description: "KPI-forward",
    kind: "dashboard",
    render: () => ({
      title: "Exec",
      columns: 3,
      items: [{ type: "kpi", label: "Total", value: 336800 }, chartCell(MONTHLY, { chartType: "line" })],
    }),
  },
  {
    id: "revenue_trend",
    title: "Revenue trend",
    description: "Monthly revenue line",
    kind: "chart",
    render: () => chart(MONTHLY, { chartType: "line", title: "Monthly revenue" }),
  },
  {
    id: "region_breakdown",
    title: "Region breakdown",
    description: "Pie of revenue by region",
    kind: "chart",
    render: () => chart(BY_REGION, { chartType: "pie", title: "By region" }),
  },
  {
    id: "order_funnel",
    title: "Order funnel",
    description: "Funnel of orders",
    kind: "chart",
    render: () =>
      chart(
        [
          { status: "shipped", orders: 812 },
          { status: "open", orders: 143 },
        ],
        { chartType: "funnel" },
      ),
  },
];

// Minimal structural type so the fixture views can return dashboard literals without importing the type.
type DashboardShape = { title?: string; columns?: number; items: unknown[] };

async function connect(configure: (s: McpServer) => void): Promise<Client> {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  configure(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

describe("addViews", () => {
  it("registers explore_views (no _meta) and render_view (outputSchema + widget _meta) + the widget resource", async () => {
    const client = await connect((s) => addViews(s, { views: VIEWS }));
    const { tools } = await client.listTools();
    const explore = tools.find((t) => t.name === "explore_views")! as any;
    const render = tools.find((t) => t.name === "render_view")! as any;
    expect(explore).toBeDefined();
    expect(explore._meta).toBeUndefined();
    expect(render).toBeDefined();
    expect(render.outputSchema).toBeDefined();
    expect(render._meta.ui.resourceUri).toBe("ui://bonnard/chart");

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("ui://bonnard/chart");
  });

  it("explore_views returns structuredContent.views of length 5 with ids + kinds", async () => {
    const client = await connect((s) => addViews(s, { views: VIEWS }));
    const res = (await client.callTool({ name: "explore_views", arguments: {} })) as any;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.views).toHaveLength(5);
    expect(res.structuredContent.views.map((v: any) => v.id)).toEqual([
      "sales_overview",
      "exec_summary",
      "revenue_trend",
      "region_breakdown",
      "order_funnel",
    ]);
    expect(res.structuredContent.views[0].kind).toBe("dashboard");
    // params surface as {name,type,required}
    expect(res.structuredContent.views[0].params).toEqual([
      { name: "region", type: expect.any(String), required: false },
    ]);
  });

  it("render_view of a single chart returns a ChartSpec bound to the widget", async () => {
    const client = await connect((s) => addViews(s, { views: VIEWS }));
    const res = (await client.callTool({ name: "render_view", arguments: { view_id: "revenue_trend" } })) as any;
    expect(res.isError).toBeFalsy();
    expect(isChartSpec(res.structuredContent)).toBe(true);
    expect(res._meta.ui.resourceUri).toBe("ui://bonnard/chart");
  });

  it("render_view of a dashboard with a param returns a DashboardSpec with changed numbers", async () => {
    const client = await connect((s) => addViews(s, { views: VIEWS }));
    const all = (await client.callTool({ name: "render_view", arguments: { view_id: "sales_overview" } })) as any;
    const eu = (await client.callTool({
      name: "render_view",
      arguments: { view_id: "sales_overview", params: { region: "EU" } },
    })) as any;
    expect(isDashboardSpec(all.structuredContent)).toBe(true);
    expect(isDashboardSpec(eu.structuredContent)).toBe(true);
    expect(eu.structuredContent.title).toBe("Sales (EU)");
    expect(eu.structuredContent.items[0].value).not.toBe(all.structuredContent.items[0].value);
  });

  it("an unknown param key yields an isError result", async () => {
    const client = await connect((s) => addViews(s, { views: VIEWS }));
    const res = (await client.callTool({
      name: "render_view",
      arguments: { view_id: "sales_overview", params: { bogus: 1 } },
    })) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/invalid param/i);
  });

  it("render_view catalog description embeds one line per view", async () => {
    const client = await connect((s) => addViews(s, { views: VIEWS }));
    const { tools } = await client.listTools();
    const render = tools.find((t) => t.name === "render_view")!;
    expect(render.description).toContain("`revenue_trend`");
    expect(render.description).toContain("`sales_overview`");
  });

  it("throws at registration on an empty registry", () => {
    const s = new McpServer({ name: "t", version: "1.0.0" });
    expect(() => addViews(s, { views: [] })).toThrow(/non-empty/);
  });

  it("throws at registration on duplicate ids", () => {
    const s = new McpServer({ name: "t", version: "1.0.0" });
    const dup: ViewDef[] = [
      { id: "x", title: "X", description: "d", render: () => chart(MONTHLY, {}) },
      { id: "x", title: "X2", description: "d", render: () => chart(MONTHLY, {}) },
    ];
    expect(() => addViews(s, { views: dup })).toThrow(/duplicate view id "x"/);
  });
});

describe("render_view item_id (cell selection)", () => {
  it("selects one chart cell: a ChartSpec bound to the widget, with the chart summary", async () => {
    const client = await connect((s) => addViews(s, { views: VIEWS }));
    const whole = (await client.callTool({
      name: "render_view",
      arguments: { view_id: "sales_overview" },
    })) as any;
    const cell = (await client.callTool({
      name: "render_view",
      arguments: { view_id: "sales_overview", item_id: "by_region" },
    })) as any;
    expect(cell.isError).toBeFalsy();
    expect(isChartSpec(cell.structuredContent)).toBe(true);
    expect(cell._meta.ui.resourceUri).toBe("ui://bonnard/chart");
    const wholeCell = whole.structuredContent.items.find((it: any) => it.id === "by_region");
    expect(cell.structuredContent).toEqual(wholeCell.spec);
  });

  it("applies params before selection: the EU cell reflects the filtered data", async () => {
    const client = await connect((s) => addViews(s, { views: VIEWS }));
    const cell = (await client.callTool({
      name: "render_view",
      arguments: { view_id: "sales_overview", params: { region: "EU" }, item_id: "by_region" },
    })) as any;
    expect(cell.isError).toBeFalsy();
    expect(isChartSpec(cell.structuredContent)).toBe(true);
    expect(cell.structuredContent.data).toHaveLength(1);
    expect(cell.structuredContent.data[0].region).toBe("EU");
  });

  it("bad item_id errors and lists the selectable chart-cell ids", async () => {
    const client = await connect((s) => addViews(s, { views: VIEWS }));
    const res = (await client.callTool({
      name: "render_view",
      arguments: { view_id: "sales_overview", item_id: "trendz" },
    })) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/unknown item_id "trendz"/);
    expect(res.content[0].text).toContain(`"by_region"`);
  });

  it("item_id on a chart-kind view errors (does not apply)", async () => {
    const client = await connect((s) => addViews(s, { views: VIEWS }));
    const res = (await client.callTool({
      name: "render_view",
      arguments: { view_id: "revenue_trend", item_id: "anything" },
    })) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/is a single chart; item_id does not apply/);
  });

  it("item_id matching a KPI id errors (not a chart)", async () => {
    const client = await connect((s) => addViews(s, { views: VIEWS }));
    const res = (await client.callTool({
      name: "render_view",
      arguments: { view_id: "sales_overview", item_id: "total_rev" },
    })) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/is a kpi tile, not a chart/);
  });

  it("a dashboard with no cell ids reports how to enable selection", async () => {
    const client = await connect((s) => addViews(s, { views: VIEWS }));
    const res = (await client.callTool({
      name: "render_view",
      arguments: { view_id: "exec_summary", item_id: "x" },
    })) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/no items with ids; add id to chartCell/);
  });
});
