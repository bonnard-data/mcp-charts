// Structural (linkedom) + SSR-snapshot tests for the dashboard renderer. Matches house style
// (no Playwright; real-pixel checks stay manual via examples/dashboard.html). Iterates the shared
// fixtures so the widget and the platform's compose provably agree on the same specs.
import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { dashboardFixtures } from "@bonnard/mcp-charts/fixtures";
import type { DashboardSpec } from "@bonnard/mcp-charts";
import { renderDashboardShell, renderKpi, renderChartNotes, renderTextBlock } from "../src/dashboard.js";
import { renderToSvg } from "../src/ssr.js";
import type { ChartSpec } from "@bonnard/mcp-charts";

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
    // Every chart cell holds an empty `.cell-chart` mount point keyed by index (the note sibling,
    // when present, sits next to it — none of these fixtures carry notes).
    d.querySelectorAll(".cell.chart").forEach((cell, i) => {
      const mount = cell.querySelector(".cell-chart");
      expect(mount?.getAttribute("id")).toBe(`cell-${i}`);
      expect(mount?.innerHTML).toBe("");
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

  it("newRow: a tile with newRow:true gets data-new-row; a plain tile keeps behaving as before", () => {
    const d = doc(
      renderDashboardShell({
        columns: 2,
        items: [
          { type: "text", text: "top" },
          { type: "text", text: "below", newRow: true },
        ],
      } as unknown as DashboardSpec),
    );
    const cells = d.querySelectorAll(".cell.text-block");
    expect(cells[0].getAttribute("data-new-row")).toBeNull();
    expect(cells[1].getAttribute("data-new-row")).toBe("true");
  });

  it("newRow composes with span: a spanned tile can also start a new row", () => {
    const d = doc(
      renderDashboardShell({
        columns: 2,
        items: [{ type: "text", text: "wide break", span: 2, newRow: true }],
      } as unknown as DashboardSpec),
    );
    const cell = d.querySelector(".cell")!;
    expect(cell.getAttribute("data-span")).toBe("2");
    expect(cell.getAttribute("data-new-row")).toBe("true");
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

  it("text block renders markdown: **bold** becomes <strong>, heading stays plain-escaped", () => {
    const html = renderTextBlock({ type: "text", heading: "Q2 <b>Overview</b>", text: "Test test **Bold**" });
    const d = doc(html);
    // Body markdown: **bold** -> <strong>, and no literal asterisks survive.
    expect(d.querySelector(".text-body strong")?.textContent).toBe("Bold");
    expect(d.querySelector(".text-body")?.textContent).not.toContain("**");
    // Heading is a plain title field: escaped, never markdown/HTML.
    const h3 = d.querySelector("h3")!;
    expect(h3.textContent).toBe("Q2 <b>Overview</b>");
    expect(h3.querySelector("b")).toBeNull();
  });

  it("text block does not pass source HTML through (html: false): an <img onerror> does not survive as a live element", () => {
    const html = renderTextBlock({ type: "text", text: 'hi <img src=x onerror="alert(1)"> bye' });
    // markdown-it with html:false escapes raw HTML in the source to literal text: the `<`/`>`/`"`
    // become entities, so no live <img> tag and no parseable onerror attribute survive.
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain('onerror="alert');
    const d = doc(html);
    expect(d.querySelector(".text-body img")).toBeNull();
    // The whole payload is inert escaped text inside the paragraph.
    expect(d.querySelector(".text-body")?.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  // A chart cell whose spec carries a note renders a `.cell-notes` sibling next to the mount point,
  // so a blank-chart / coerced-column advisory reaches the human, not just the agent text.
  it("chart cell with notes renders a .cell-notes block next to the mount point", () => {
    const spec: ChartSpec = {
      chartType: "bar",
      data: [],
      x: "region",
      series: [],
      legend: false,
      notes: ["No measure column to plot - the chart has no data series."],
    };
    const dash: DashboardSpec = { items: [{ spec }] };
    const d = doc(renderDashboardShell(dash));
    const cell = d.querySelector(".cell.chart")!;
    expect(cell.querySelector(".cell-chart")?.getAttribute("id")).toBe("cell-0");
    expect(cell.querySelector(".cell-notes")?.textContent).toContain("No measure column to plot");
  });

  // The single-chart path (main.ts) and the dashboard cell share renderChartNotes, so this covers
  // both: notes present -> a muted, escaped block; none -> empty string.
  it("renderChartNotes renders (and escapes) notes, empty when there are none", () => {
    const withNotes: ChartSpec = {
      chartType: "line",
      data: [],
      x: "d",
      series: [],
      legend: false,
      notes: ["<b>coerced</b> to numbers"],
    };
    const html = renderChartNotes(withNotes);
    expect(html).toContain("cell-notes");
    expect(html).toContain("&lt;b&gt;coerced");
    expect(html).not.toContain("<b>coerced");
    const none: ChartSpec = { chartType: "bar", data: [], x: "", series: [], legend: false };
    expect(renderChartNotes(none)).toBe("");
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
