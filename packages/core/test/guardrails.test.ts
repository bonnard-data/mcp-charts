// Inference guardrails + typed-data path: numeric-string recovery, the zero-series note, notes
// surfacing on the agent-text paths, the chart(ChartData) overload, explain(), and strict mode.
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { chart, chartCell, explain, summarizeDashboard, addViews } from "../src/views.js";
import { buildChartData } from "../src/adapters/sql.js";
import type { ChartData, DashboardSpec, FieldKind, SourceColumn } from "../src/types.js";

const run = <T>(fn: () => T): { value?: T; threw?: string } => {
  try {
    return { value: fn() };
  } catch (e) {
    return { threw: (e as Error).message };
  }
};

const mapKind = (type: unknown): FieldKind =>
  (({ string: "string", number: "number", time: "time", boolean: "boolean" }) as Record<string, FieldKind>)[
    String(type)
  ] ?? "string";
const col = (name: string, type: string): SourceColumn => ({ name, type });

// =============================================================================================
// explain(): a diagnostic WITHOUT the render payload, for asserting the encoding in CI.
// =============================================================================================
describe("explain", () => {
  it("returns fields, chartType, x, series, notes for a healthy bar", () => {
    const rows = [
      { region: "EU", revenue: 10 },
      { region: "US", revenue: 20 },
    ];
    const ex = explain(rows, { chartType: "bar" });
    expect(ex.fields).toEqual([
      { name: "region", kind: "string", role: "dimension" },
      { name: "revenue", kind: "number", role: "measure" },
    ]);
    expect(ex.chartType).toBe("bar");
    expect(ex.x).toBe("region");
    expect(ex.series).toEqual(["revenue"]);
    expect(ex.notes).toEqual([]);
  });

  it("carries NO render payload (no data rows on the diagnostic)", () => {
    const ex = explain([{ region: "EU", revenue: 10 }], { chartType: "bar" });
    expect(ex).not.toHaveProperty("data");
  });

  it("recovers a numeric-string measure and reports a non-empty series", () => {
    const rows = [
      { region: "EU", sales: "1234" },
      { region: "US", sales: "5678" },
    ];
    const ex = explain(rows, { chartType: "bar" });
    expect(ex.fields.find((f) => f.name === "sales")).toMatchObject({ kind: "number", role: "measure" });
    expect(ex.series).toEqual(["sales"]);
    expect(ex.series.length).toBeGreaterThan(0);
    expect(ex.notes.some((n) => /arrived as numbers stored as strings/.test(n))).toBe(true);
  });

  it("reports the zero-series note on a blank encoding", () => {
    const rows = [
      { region: "EU", val: null },
      { region: "US", val: null },
    ];
    const ex = explain(rows, { chartType: "bar" });
    expect(ex.series).toEqual([]);
    expect(ex.notes.some((n) => /No measure column to plot/.test(n))).toBe(true);
  });
});

// =============================================================================================
// strict: promote encoding-failure advisories to throws (authoring / CI posture).
// =============================================================================================
describe("strict mode", () => {
  it("throws on zero series", () => {
    const rows = [
      { region: "EU", val: null },
      { region: "US", val: null },
    ];
    const { threw } = run(() => explain(rows, { chartType: "bar", strict: true }));
    expect(threw).toMatch(/No measure column to plot/);
  });

  it("throws on an ignored (unknown) encode column", () => {
    const rows = [
      { region: "EU", sales: 10 },
      { region: "US", sales: 20 },
    ];
    const { threw } = run(() => chart(rows, { encode: { x: "region", y: "profit" }, strict: true }));
    expect(threw).toMatch(/Ignored unknown encode column "profit"/);
  });

  it("does NOT throw on a healthy encoding", () => {
    const rows = [
      { region: "EU", sales: 10 },
      { region: "US", sales: 20 },
    ];
    const { value, threw } = run(() => chart(rows, { chartType: "bar", strict: true }));
    expect(threw).toBeUndefined();
    expect(value!.series.map((s) => s.key)).toEqual(["sales"]);
  });
});

// =============================================================================================
// chart(ChartData) overload: a typed ChartData rides driver types instead of sniffing.
// =============================================================================================
describe("chart(ChartData) overload", () => {
  it("renders a declared numeric column even when the values are strings (no sniff)", () => {
    // A driver that stringifies numerics but declares the column NUMBER: the typed path trusts the
    // declaration, so measure-coercion plots it — same result as recovery, but driven by types.
    const data: ChartData = {
      rows: [
        { region: "EU", sales: "1234" },
        { region: "US", sales: "5678" },
      ],
      fields: [
        { name: "region", kind: "string", role: "dimension" },
        { name: "sales", kind: "number", role: "measure" },
      ],
    };
    const spec = chart(data, { chartType: "bar" });
    expect(spec.series.map((s) => s.key)).toEqual(["sales"]);
    expect(spec.data.map((r) => r.sales)).toEqual([1234, 5678]);
  });

  it("equals the raw-rows route for the same rows (line count parity)", () => {
    const rows = [
      { month: "2026-01", revenue: 10 },
      { month: "2026-02", revenue: 20 },
    ];
    const typed = buildChartData({
      rows,
      columns: [col("month", "time"), col("revenue", "number")],
      mapKind,
    });
    const fromTyped = chart(typed, { chartType: "line" });
    const fromRaw = chart(rows, { chartType: "line" });
    expect(fromTyped).toEqual(fromRaw);
  });

  it("passes a ChartData's own notes through to the spec", () => {
    const data: ChartData = {
      rows: [{ region: "EU", revenue: 10 }],
      notes: ["Result truncated at the row cap."],
    };
    const spec = chart(data, { chartType: "bar" });
    expect(spec.notes).toContain("Result truncated at the row cap.");
  });

  it("chartCell accepts a ChartData too", () => {
    const data: ChartData = {
      rows: [
        { region: "EU", revenue: 10 },
        { region: "US", revenue: 20 },
      ],
      fields: [
        { name: "region", kind: "string", role: "dimension" },
        { name: "revenue", kind: "number", role: "measure" },
      ],
    };
    const cell = chartCell(data, { chartType: "bar", span: 2 });
    expect(cell.span).toBe(2);
    expect(cell.spec.series.map((s) => s.key)).toEqual(["revenue"]);
  });
});

// =============================================================================================
// Notes on the agent-text paths: chartSummary (via a view) + summarizeDashboard roll up cell notes.
// =============================================================================================
describe("notes surface on agent text", () => {
  it("chart() merges a coerced-column advisory into the spec notes", () => {
    const rows = [
      { region: "EU", sales: "1234" },
      { region: "US", sales: "5678" },
    ];
    const spec = chart(rows, { chartType: "bar" });
    expect(spec.notes?.some((n) => /arrived as numbers stored as strings/.test(n))).toBe(true);
  });

  it("summarizeDashboard rolls each chart cell's notes into the summary", () => {
    const spec: DashboardSpec = {
      title: "Sales",
      items: [
        chartCell(
          [
            { region: "EU", val: null },
            { region: "US", val: null },
          ],
          { chartType: "bar", title: "Blank" },
        ),
        chartCell(
          [
            { region: "EU", sales: "1234" },
            { region: "US", sales: "5678" },
          ],
          {
            chartType: "bar",
            title: "Coerced",
          },
        ),
      ],
      notes: ["Top-level note."],
    };
    const text = summarizeDashboard(spec);
    expect(text).toMatch(/No measure column to plot/); // zero-series cell note
    expect(text).toMatch(/arrived as numbers stored as strings/); // coerced cell note
    expect(text).toMatch(/Top-level note\./); // top-level note kept
  });

  it("render_view's single-chart summary text carries the chart's notes to the agent", async () => {
    const server = new McpServer({ name: "t", version: "1.0.0" });
    addViews(server, {
      views: [
        {
          id: "blank",
          title: "Blank",
          description: "d",
          render: () =>
            chart(
              [
                { region: "EU", val: null },
                { region: "US", val: null },
              ],
              { chartType: "bar" },
            ),
        },
      ],
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "1.0.0" });
    await Promise.all([server.connect(st), client.connect(ct)]);
    const res = (await client.callTool({ name: "render_view", arguments: { view_id: "blank" } })) as {
      content: { text: string }[];
    };
    expect(res.content[0]!.text).toMatch(/No measure column to plot/);
  });
});
