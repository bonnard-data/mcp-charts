// Contract test for addCharts (SQL mode), driven through a real in-memory MCP Client.
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { addCharts } from "../src/charts.js";
import type { ChartData } from "../src/types.js";

// Mock data source: ignores the SQL, returns a fixed typed result.
const fakeRunSql = async (_sql: string): Promise<ChartData> => ({
  rows: [
    { region: "EU", revenue: 29300 },
    { region: "US", revenue: 22500 },
    { region: "APAC", revenue: 300 },
  ],
  fields: [
    { name: "region", role: "dimension", kind: "string" },
    { name: "revenue", role: "measure", kind: "number", format: "currency", currency: "USD" },
  ],
});

async function connect(configure: (s: McpServer) => void): Promise<Client> {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  configure(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

describe("addCharts (SQL mode)", () => {
  it("registers a visualize tool with sql + presentation inputs", async () => {
    const client = await connect((s) =>
      addCharts(s, { runSql: fakeRunSql, discovery: { toolName: "explore_schema" } }),
    );
    const { tools } = await client.listTools();
    const viz = tools.find((t) => t.name === "visualize");
    expect(viz).toBeDefined();
    const props = (viz!.inputSchema as any).properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["sql", "chartType", "encode", "title"]));
    expect(viz!.description).toMatch(/explore_schema/); // discovery hint surfaced
  });

  it("calling visualize returns a ChartSpec in structuredContent", async () => {
    const client = await connect((s) => addCharts(s, { runSql: fakeRunSql }));
    const res = (await client.callTool({
      name: "visualize",
      arguments: {
        sql: "SELECT region, SUM(amount) revenue FROM orders GROUP BY 1",
        chartType: "bar",
        title: "Revenue by region",
      },
    })) as any;

    const spec = res.structuredContent;
    expect(spec.chartType).toBe("bar");
    expect(spec.x).toBe("region");
    expect(spec.series).toEqual([{ key: "revenue", label: "Revenue" }]);
    expect(spec.yAxis.format).toBe("currency");
    expect(spec.title).toBe("Revenue by region");
    expect(spec.data.length).toBe(3);
    // text fallback carries the data for non-widget clients
    expect(res.content[0].text).toContain("Revenue by region");
  });

  it("echoes only a sample of rows in the text fallback for a large result", async () => {
    const bigRunSql = async (): Promise<ChartData> => ({
      rows: Array.from({ length: 100 }, (_, i) => ({
        day: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
        revenue: i + 1,
      })),
      fields: [
        { name: "day", role: "time", kind: "time" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    });
    const client = await connect((s) => addCharts(s, { runSql: bigRunSql }));
    const res = (await client.callTool({
      name: "visualize",
      arguments: { sql: "SELECT ...", chartType: "line" },
    })) as any;
    // The chart (structuredContent) keeps every point; the text echo is capped.
    expect(res.structuredContent.data.length).toBe(100);
    expect(res.content[0].text).toContain("first 50 of 100 rows");
  });

  it("auto-detects chart type when omitted", async () => {
    const client = await connect((s) => addCharts(s, { runSql: fakeRunSql }));
    const res = (await client.callTool({ name: "visualize", arguments: { sql: "..." } })) as any;
    expect(res.structuredContent.chartType).toBe("bar"); // dimension + measure
  });

  it("surfaces data-source errors as a tool error", async () => {
    const client = await connect((s) =>
      addCharts(s, {
        runSql: async () => {
          throw new Error("syntax error near FROM");
        },
      }),
    );
    const res = (await client.callTool({ name: "visualize", arguments: { sql: "bad" } })) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/syntax error/);
  });

  it("links the tool to a ui:// widget resource (MCP Apps + ChatGPT alias)", async () => {
    const client = await connect((s) => addCharts(s, { runSql: fakeRunSql }));
    const { tools } = await client.listTools();
    const viz = tools.find((t) => t.name === "visualize")! as any;
    expect(viz._meta.ui.resourceUri).toBe("ui://bonnard/chart");
    expect(viz._meta["openai/outputTemplate"]).toBe("ui://bonnard/chart");

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("ui://bonnard/chart");
    const read = await client.readResource({ uri: "ui://bonnard/chart" });
    const first = read.contents[0] as any;
    expect(first.mimeType).toBe("text/html;profile=mcp-app");
    expect(first.text).toMatch(/<!doctype html>/i);
  });

  it("rejects a non-array rows return with a clear error", async () => {
    const client = await connect((s) => addCharts(s, { runSql: async () => ({ rows: { oops: 1 } as any }) }));
    const res = (await client.callTool({ name: "visualize", arguments: { sql: "x" } })) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/array of objects/i);
  });

  it("rejects arrays-of-arrays (rows not keyed by column)", async () => {
    const client = await connect((s) => addCharts(s, { runSql: async () => ({ rows: [["EU", 1]] as any }) }));
    const res = (await client.callTool({ name: "visualize", arguments: { sql: "x" } })) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/flat object/i);
  });

  it("rejects a non-scalar value in a plotted column", async () => {
    const client = await connect((s) =>
      addCharts(s, { runSql: async () => ({ rows: [{ region: { n: "EU" }, revenue: 1 }] }) }),
    );
    const res = (await client.callTool({ name: "visualize", arguments: { sql: "x", chartType: "bar" } })) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/scalar|object/i);
  });

  it("does NOT reject a non-scalar value in an unplotted column", async () => {
    const client = await connect((s) =>
      addCharts(s, { runSql: async () => ({ rows: [{ region: "EU", revenue: 1, blob: { x: 1 } }] }) }),
    );
    const res = (await client.callTool({ name: "visualize", arguments: { sql: "x", chartType: "bar" } })) as any;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.chartType).toBe("bar");
  });

  it("empty rows -> a friendly no-data result (not an error)", async () => {
    const client = await connect((s) => addCharts(s, { runSql: async () => ({ rows: [] }) }));
    const res = (await client.callTool({ name: "visualize", arguments: { sql: "x", title: "Q3" } })) as any;
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toMatch(/no rows/i);
    expect(res.structuredContent.data).toEqual([]);
  });

  it("respects the allow list (restricts chartType enum)", async () => {
    const client = await connect((s) => addCharts(s, { runSql: fakeRunSql, allow: ["bar", "line"] }));
    const { tools } = await client.listTools();
    const viz = tools.find((t) => t.name === "visualize")!;
    const enumVals = (viz.inputSchema as any).properties.chartType.enum;
    expect(enumVals.sort()).toEqual(["bar", "line"]);
  });
});
