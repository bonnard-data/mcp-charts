import { describe, it, expect } from "vitest";
import { isChartSpec, isDashboardSpec } from "../src/dashboard.js";
import { dashboardFixtures, buildCellSpec } from "../src/fixtures/dashboards.js";
import type { ChartCell } from "../src/types.js";

const isChartCell = (item: unknown): item is ChartCell => !!item && typeof item === "object" && "spec" in item;

describe("dashboard guards", () => {
  it("isDashboardSpec accepts every fixture spec", () => {
    for (const fx of dashboardFixtures) expect(isDashboardSpec(fx.spec), fx.name).toBe(true);
  });

  it("isDashboardSpec rejects every ChartSpec (has data, no items)", () => {
    for (const fx of dashboardFixtures) {
      for (const item of fx.spec.items) {
        if (isChartCell(item)) expect(isDashboardSpec(item.spec), fx.name).toBe(false);
      }
    }
  });

  it("isChartSpec accepts chart-cell specs, rejects dashboard specs", () => {
    for (const fx of dashboardFixtures) {
      expect(isChartSpec(fx.spec), fx.name).toBe(false);
      for (const item of fx.spec.items) {
        if (isChartCell(item)) expect(isChartSpec(item.spec), fx.name).toBe(true);
      }
    }
  });

  it("discriminates in the widget's order (dashboard before chart)", () => {
    // A chart-cell spec is a ChartSpec; a dashboard is not. Checking isDashboardSpec first is
    // what keeps the widget from mistaking a dashboard for a chart (it has no top-level `data`).
    const dash = dashboardFixtures.find((f) => f.name === "grid-2x2")!.spec;
    expect(isDashboardSpec(dash)).toBe(true);
    expect(isChartSpec(dash)).toBe(false);
  });

  it("null / primitive inputs are rejected by both guards", () => {
    for (const v of [null, undefined, 1, "x", true]) {
      expect(isDashboardSpec(v)).toBe(false);
      expect(isChartSpec(v)).toBe(false);
    }
  });
});

describe("dashboard fixtures", () => {
  it("has all six named fixtures", () => {
    expect(dashboardFixtures.map((f) => f.name)).toEqual([
      "single-chart",
      "grid-2x2",
      "kpi-row",
      "mixed",
      "narrow-stacked",
      "degenerate",
    ]);
  });

  it("round-trips through JSON with no Dates/functions/undefined leaked", () => {
    for (const fx of dashboardFixtures) {
      const clone = JSON.parse(JSON.stringify(fx.spec));
      expect(clone, fx.name).toEqual(fx.spec);
    }
  });

  it("self-consistency: every ChartCell.spec equals resolve(buildChartData(...)) recomputed", () => {
    for (const fx of dashboardFixtures) {
      const chartInputs = fx.inputs.items.filter(
        (i): i is Extract<typeof i, { kind: "chart" }> => "kind" in i && i.kind === "chart",
      );
      const chartCells = fx.spec.items.filter(isChartCell);
      expect(chartCells.length, fx.name).toBe(chartInputs.length);
      chartInputs.forEach((input, idx) => {
        expect(chartCells[idx].spec, `${fx.name}[${idx}]`).toEqual(buildCellSpec(input));
      });
    }
  });
});
