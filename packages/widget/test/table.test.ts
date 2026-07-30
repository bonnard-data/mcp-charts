// Tables are the only chart type still rendered by hand (HTML); charts go through ECharts.
import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { resolve as resolveSpec } from "@bonnard/mcp-charts";
import { renderTable } from "../src/table.js";
import { fixtures, type Fixture } from "./fixtures.js";

const f = (name: string): Fixture => fixtures.find((x) => x.name === name)!;

describe("renderTable", () => {
  it("renders one body row per record", () => {
    const fx = f("table-plain");
    const html = renderTable(resolveSpec(fx.data, fx.opts));
    const doc = parseHTML(`<div>${html}</div>`).document as unknown as Document;
    expect(doc.querySelectorAll("table.tbl tbody tr").length).toBe(2);
  });

  it("shows exact numbers, not chart-style K/M abbreviations", () => {
    const html = renderTable(resolveSpec({ rows: [{ label: "A", revenue: 2_400_000 }] }, { chartType: "table" }));
    expect(html).toContain("2,400,000");
    expect(html).not.toContain("2.4M");
  });

  it("renders an explicit empty-state (not a headerless empty table) for 0 rows", () => {
    const emptySpec = { chartType: "table" as const, data: [], x: "", series: [], legend: false, columns: [] };
    const html = renderTable(emptySpec);
    expect(html).toContain("data-empty");
    expect(html).toContain("No data");
    expect(html).not.toContain("<table");
  });

  it("wraps the table in a scroll container so it can bound its own overflow", () => {
    const fx = f("table-plain");
    const html = renderTable(resolveSpec(fx.data, fx.opts));
    const doc = parseHTML(`<div>${html}</div>`).document as unknown as Document;
    const scroll = doc.querySelector("div.tbl-scroll");
    expect(scroll).not.toBeNull();
    // The table lives inside the scroll container, not as a bare sibling.
    expect(scroll!.querySelector("table.tbl")).not.toBeNull();
    expect(doc.querySelectorAll("div.tbl-scroll > table.tbl").length).toBe(1);
  });

  it("keeps a long, wide table inside the scroll container rather than emitting a bare table", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: `o_${i}`,
      a: i,
      b: i * 2,
      c: i * 3,
      d: i * 4,
      e: i * 5,
      f: i * 6,
      g: i * 7,
    }));
    const html = renderTable(resolveSpec({ rows }, { chartType: "table" }));
    const doc = parseHTML(`<div>${html}</div>`).document as unknown as Document;
    // Every table produced is wrapped: no raw <table> escapes the scroll container to grow/clip.
    expect(doc.querySelectorAll("table.tbl").length).toBe(1);
    expect(doc.querySelectorAll("div.tbl-scroll > table.tbl").length).toBe(1);
    expect(doc.querySelectorAll("table.tbl tbody tr").length).toBe(200);
  });
});
