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
});
