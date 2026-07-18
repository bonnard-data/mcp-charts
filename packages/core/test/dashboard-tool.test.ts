// Dashboard authoring helpers: chartCell parity with the raw routes, summarizeDashboard bounds,
// dashboardResult envelope, and addDashboardTool driven through a real in-memory MCP Client.
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { chartCell, dashboardResult, summarizeDashboard, addDashboardTool } from "../src/dashboard-tool.js";
import { resolve } from "../src/resolve/resolve.js";
import { buildChartData } from "../src/adapters/sql.js";
import { isDashboardSpec } from "../src/dashboard.js";
import type { DashboardSpec, FieldKind, SourceColumn } from "../src/types.js";

const mapKind = (type: unknown): FieldKind =>
  (({ string: "string", number: "number", time: "time", boolean: "boolean" }) as Record<string, FieldKind>)[
    String(type)
  ] ?? "string";
const col = (name: string, type: string): SourceColumn => ({ name, type });

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

describe("chartCell", () => {
  it("time-x line: spec equals both the raw-rows and legacy buildChartData routes", () => {
    const cell = chartCell(MONTHLY, { chartType: "line", title: "Revenue by month" });
    const rawRoute = resolve({ rows: MONTHLY }, { chartType: "line", title: "Revenue by month" });
    const legacyRoute = resolve(
      buildChartData({ rows: MONTHLY, columns: [col("month", "time"), col("revenue", "number")], mapKind }),
      { chartType: "line", title: "Revenue by month" },
    );
    expect(cell.spec).toEqual(rawRoute);
    expect(cell.spec).toEqual(legacyRoute);
    expect(cell.span).toBeUndefined();
  });

  it("categorical bar: spec equals both routes", () => {
    const cell = chartCell(BY_REGION, { chartType: "bar", title: "Revenue by region" });
    const rawRoute = resolve({ rows: BY_REGION }, { chartType: "bar", title: "Revenue by region" });
    const legacyRoute = resolve(
      buildChartData({ rows: BY_REGION, columns: [col("region", "string"), col("revenue", "number")], mapKind }),
      { chartType: "bar", title: "Revenue by region" },
    );
    expect(cell.spec).toEqual(rawRoute);
    expect(cell.spec).toEqual(legacyRoute);
  });

  it("carries span when set", () => {
    expect(chartCell(MONTHLY, { chartType: "line", span: 2 }).span).toBe(2);
  });
});

const sampleDashboard = (): DashboardSpec => ({
  title: "Sales Dashboard",
  columns: 2,
  items: [
    { type: "kpi", label: "Total revenue", value: 336800, format: "currency", currency: "USD", delta: 61800 },
    { type: "kpi", label: "Orders", value: 992 },
    chartCell(MONTHLY, { chartType: "line", title: "Revenue by month", span: 2 }),
    chartCell(BY_REGION, { chartType: "bar", title: "Revenue by region" }),
    { type: "text", heading: "Summary", text: "Revenue is trending up." },
  ],
  notes: ["Figures are illustrative."],
});

describe("summarizeDashboard", () => {
  it("includes the title, each KPI value, and each chart title; stays bounded", () => {
    const spec = sampleDashboard();
    const text = summarizeDashboard(spec);
    expect(text).toContain("Sales Dashboard");
    expect(text).toContain("336800"); // KPI value
    expect(text).toContain("992");
    expect(text).toContain("Revenue by month"); // chart titles
    expect(text).toContain("Revenue by region");
    expect(text).toContain("Figures are illustrative."); // notes
    // O(items), not O(rows): no raw row payload echoed.
    expect(text).not.toContain("2026-01-01");
    expect(text).not.toContain("42000");
    expect(text.split("\n").length).toBeLessThanOrEqual(spec.items.length + 2);
  });
});

describe("dashboardResult", () => {
  it("structuredContent is the spec and _meta links the widget (both aliases)", () => {
    const spec = sampleDashboard();
    const res = dashboardResult(spec);
    expect(res.structuredContent).toBe(spec);
    expect(res._meta.ui.resourceUri).toBe("ui://bonnard/chart");
    expect(res._meta["openai/outputTemplate"]).toBe("ui://bonnard/chart");
    expect(res.content[0].text).toBe(summarizeDashboard(spec));
  });

  it("honors a custom string summary", () => {
    const res = dashboardResult(sampleDashboard(), { summary: "custom text" });
    expect(res.content[0].text).toBe("custom text");
  });

  it("honors a custom function summary", () => {
    const res = dashboardResult(sampleDashboard(), { summary: (s) => `title is ${s.title}` });
    expect(res.content[0].text).toBe("title is Sales Dashboard");
  });
});

async function connect(configure: (s: McpServer) => void): Promise<Client> {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  configure(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

describe("addDashboardTool", () => {
  it("registers the tool with outputSchema + widget _meta, and the widget resource", async () => {
    const client = await connect((s) =>
      addDashboardTool(
        s,
        { name: "sales_dashboard", description: "A dashboard", inputSchema: { region: z.string().optional() } },
        () => sampleDashboard(),
      ),
    );
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "sales_dashboard")! as any;
    expect(tool).toBeDefined();
    expect(tool.outputSchema).toBeDefined();
    expect(tool.outputSchema.properties.items).toBeDefined();
    expect(tool._meta.ui.resourceUri).toBe("ui://bonnard/chart");
    expect(tool._meta["openai/outputTemplate"]).toBe("ui://bonnard/chart");

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("ui://bonnard/chart");
  });

  it("calling it returns a DashboardSpec passing isDashboardSpec", async () => {
    const client = await connect((s) =>
      addDashboardTool(s, { name: "sales_dashboard", description: "d" }, () => sampleDashboard()),
    );
    const res = (await client.callTool({ name: "sales_dashboard", arguments: {} })) as any;
    expect(res.isError).toBeFalsy();
    expect(isDashboardSpec(res.structuredContent)).toBe(true);
    expect(res.structuredContent.title).toBe("Sales Dashboard");
    expect(res.content[0].text).toContain("Sales Dashboard");
  });

  it("accepts a { spec, summary } handler return", async () => {
    const client = await connect((s) =>
      addDashboardTool(s, { name: "d", description: "d" }, () => ({
        spec: sampleDashboard(),
        summary: "override",
      })),
    );
    const res = (await client.callTool({ name: "d", arguments: {} })) as any;
    expect(res.content[0].text).toBe("override");
    expect(isDashboardSpec(res.structuredContent)).toBe(true);
  });

  it("a thrown handler error yields an isError result", async () => {
    const client = await connect((s) =>
      addDashboardTool(s, { name: "boom", description: "d" }, () => {
        throw new Error("no data");
      }),
    );
    const res = (await client.callTool({ name: "boom", arguments: {} })) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/boom failed: no data/);
  });
});
