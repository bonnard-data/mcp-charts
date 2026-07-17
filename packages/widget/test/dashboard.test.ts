// Structural (linkedom) + SSR-snapshot tests for the dashboard renderer. Matches house style
// (no Playwright; real-pixel checks stay manual via examples/dashboard.html). Iterates the shared
// fixtures so the widget and the platform's compose provably agree on the same specs.
import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { dashboardFixtures } from "@bonnard/mcp-charts/fixtures";
import type { DashboardSpec } from "@bonnard/mcp-charts";
import { renderDashboardShell, renderKpi } from "../src/dashboard.js";
import { renderToSvg } from "../src/ssr.js";

const spec = (name: string): DashboardSpec => dashboardFixtures.find((f) => f.name === name)!.spec;
const doc = (html: string): Document => parseHTML(`<div>${html}</div>`).document as unknown as Document;

describe("renderDashboardShell — structure", () => {
  it("grid-2x2: 4 cells, --cols:2, chart cells empty with id=cell-<i>", () => {
    const d = doc(renderDashboardShell(spec("grid-2x2")));
    const grid = d.querySelector(".grid")!;
    expect(grid.getAttribute("style")).toContain("--cols:2");
    expect(d.querySelectorAll(".cell").length).toBe(4);
    // All four are chart cells (bar, line, pie, table — a table is a chart cell painted by main.ts).
    expect(d.querySelectorAll(".cell.chart").length).toBe(4);
    // Every chart cell (including the table) is an empty placeholder keyed by index.
    d.querySelectorAll(".cell").forEach((cell, i) => {
      if (cell.classList.contains("chart")) {
        expect(cell.getAttribute("id")).toBe(`cell-${i}`);
        expect(cell.innerHTML).toBe("");
      }
    });
  });

  it("mixed: text cell has data-span=2 and its heading; KPI shows formatted value + delta", () => {
    const d = doc(renderDashboardShell(spec("mixed")));
    const text = d.querySelector(".cell.text-block")!;
    expect(text.getAttribute("data-span")).toBe("2");
    expect(text.querySelector("h3")?.textContent).toBe("Q2 Overview");

    const kpis = d.querySelectorAll(".cell.kpi");
    const currency = kpis[0];
    expect(currency.querySelector(".kpi-value")?.textContent).toContain("$128,400");
    expect(currency.querySelector(".kpi-delta.up")).toBeTruthy();
    const percent = kpis[1];
    expect(percent.querySelector(".kpi-value")?.textContent).toContain("18.4%");
    expect(percent.querySelector(".kpi-delta.down")).toBeTruthy();
  });

  it("degenerate: empty-result chart cell + null-value KPI renders a placeholder, not 'null'", () => {
    const d = doc(renderDashboardShell(spec("degenerate")));
    const kpi = d.querySelector(".cell.kpi .kpi-value")!;
    expect(kpi.textContent).toBe("—");
    expect(kpi.textContent).not.toContain("null");
    // The empty table cell is a chart placeholder painted by main.ts at render time.
    expect(d.querySelector(".cell.chart")).toBeTruthy();
  });

  it("span clamps to columns: a span:3 item in a columns:2 grid emits data-span=2", () => {
    const clamped: DashboardSpec = {
      columns: 2,
      items: [{ type: "text", text: "wide", span: 3 }],
    };
    const d = doc(renderDashboardShell(clamped));
    expect(d.querySelector(".cell")?.getAttribute("data-span")).toBe("2");
  });

  it("unknown item type renders a muted unsupported cell, does not throw", () => {
    const weird = { items: [{ type: "sunburst" }] } as unknown as DashboardSpec;
    const d = doc(renderDashboardShell(weird));
    expect(d.querySelector(".cell.unsupported")?.textContent).toBe("Unsupported item");
  });

  it("escapes strings in KPI/text (no raw HTML injection)", () => {
    const html = renderKpi({ type: "kpi", label: "<img src=x>", value: "<b>hi</b>" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>hi</b>");
    expect(html).toContain("&lt;img");
  });
});

describe("renderDashboardShell — snapshots", () => {
  for (const fx of dashboardFixtures) {
    it(`shell snapshot: ${fx.name}`, () => {
      expect(renderDashboardShell(fx.spec)).toMatchSnapshot();
    });
  }
});

describe("renderToSvg — chart cell", () => {
  it("single-chart cell renders to an SVG snapshot", () => {
    const single = spec("single-chart");
    const cell = single.items[0];
    expect("spec" in cell).toBe(true);
    if ("spec" in cell) expect(renderToSvg(cell.spec)).toMatchSnapshot();
  });
});
