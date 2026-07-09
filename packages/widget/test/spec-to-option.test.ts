// Adapter tests: ChartSpec -> EChartsOption. We test the mapping WE own (series/stack/axes/
// formatting), not ECharts' rendering. Rendering correctness is covered by the visual harness.
import { describe, it, expect } from "vitest";
import { resolve as resolveSpec } from "@bonnard/mcp-charts";
import { specToOption } from "../src/spec-to-option.js";
import { fixtures, type Fixture } from "./fixtures.js";

const f = (name: string): Fixture => fixtures.find((x) => x.name === name)!;
// ECOption is a union of nominally-distinct types; read fields loosely in assertions.

const opt = (name: string): any => specToOption(resolveSpec(f(name).data, f(name).opts));

describe("specToOption — series mapping", () => {
  it("grouped bar: one bar series per plan, no stacking", () => {
    const o = opt("grouped-bar-region-plan"); // plans: enterprise, pro, free
    expect(o.series.map((s: any) => s.type)).toEqual(["bar", "bar", "bar"]);
    expect(o.series.every((s: any) => s.stack === undefined)).toBe(true);
  });

  it("stacked bar: every series shares one stack", () => {
    const o = opt("stacked-bar");
    expect(o.series.every((s: any) => s.stack === "total")).toBe(true);
  });

  it("line: line series, no areaStyle", () => {
    const o = opt("line-monthly");
    expect(o.series[0].type).toBe("line");
    expect(o.series[0].areaStyle).toBeUndefined();
  });

  it("stacked area: line series with areaStyle and a shared stack", () => {
    const o = opt("area-stacked-plan-over-time");
    expect(o.series.every((s: any) => s.type === "line" && s.areaStyle && s.stack === "total")).toBe(true);
  });

  it("pie: a single pie series with one datum per category + a legend", () => {
    const o = opt("pie-region");
    expect(o.series.length).toBe(1);
    expect(o.series[0].type).toBe("pie");
    expect(o.series[0].data.length).toBe(3);
    expect(o.legend).toBeTruthy();
  });

  it("pie with two measures: only the first measure is plotted (no double series/legend)", () => {
    const o = opt("pie-two-measures");
    expect(o.series.length).toBe(1);
    expect(o.series[0].data.map((d: any) => d.name)).toEqual(["shipped", "open", "cancelled"]);
  });
});

describe("specToOption — axes", () => {
  it("bar: category x-axis with one label per row", () => {
    const o = opt("bar-revenue-by-status");
    expect(o.xAxis.type).toBe("category");
    expect(o.xAxis.data.length).toBe(3);
    expect(o.yAxis.type).toBe("value");
  });

  it("horizontal bar: value on x, category on y", () => {
    const o = opt("bar-horizontal");
    expect(o.xAxis.type).toBe("value");
    expect(o.yAxis.type).toBe("category");
  });

  it("time x-axis labels are formatted by granularity, not raw ISO", () => {
    const o = opt("line-monthly");
    expect(o.xAxis.data.join(" ")).not.toContain("2026-04-01");
    expect(o.xAxis.data.some((l: string) => /[A-Za-z]{3}\s?'?\d{2}/.test(l))).toBe(true); // "Apr 26"
  });
});

describe("specToOption — missing-combo gaps", () => {
  it("non-stacked line: a missing series cell becomes null (a gap), not 0", () => {
    // Hand-built spec: APAC absent in the middle point.
    const spec = {
      chartType: "line" as const,
      x: "month",
      data: [
        { month: "Jan", EU: 10, APAC: 5 },
        { month: "Feb", EU: 12 }, // APAC missing
        { month: "Mar", EU: 14, APAC: 7 },
      ],
      series: [
        { key: "EU", label: "EU" },
        { key: "APAC", label: "APAC" },
      ],
      legend: true,
    };
    const o = specToOption(spec) as any;
    const apac = o.series.find((s: any) => s.name === "APAC");
    expect(apac.data).toEqual([5, null, 7]); // gap in the middle
  });
});

describe("specToOption — adopted ECharts techniques", () => {
  it("each series carries its own tooltip valueFormatter (dual-axis seam)", () => {
    const o = opt("grouped-bar-region-plan") as any;
    expect(o.series.every((s: any) => typeof s.tooltip?.valueFormatter === "function")).toBe(true);
  });

  it("category axis is pinned to the edge (onZero:false) so negatives don't cut through it", () => {
    const o = opt("bar-net-flow-negatives") as any;
    expect(o.xAxis.axisLine.onZero).toBe(false);
    expect(o.xAxis.axisLabel.hideOverlap).toBe(true);
  });
});

describe("specToOption — numeric linear x", () => {
  it("renders numeric-x line on a value axis with [x,y] point data", () => {
    const spec = {
      chartType: "line" as const,
      x: "step",
      xAxis: { numeric: true },
      data: [
        { step: 1, y: 10 },
        { step: 5, y: 30 },
        { step: 100, y: 20 },
      ],
      series: [{ key: "y", label: "Y" }],
      legend: false,
    };
    const o = specToOption(spec) as any;
    expect(o.xAxis.type).toBe("value");
    expect(o.series[0].data).toEqual([
      [1, 10],
      [5, 30],
      [100, 20],
    ]);
  });
});

describe("specToOption — dual-axis", () => {
  it("builds two y-axes; right series is a line on yAxisIndex 1, right gridlines off", () => {
    const o = opt("combo-revenue-margin") as any;
    expect(Array.isArray(o.yAxis)).toBe(true);
    expect(o.yAxis.length).toBe(2);
    expect(o.yAxis[1].splitLine.show).toBe(false);
    const right = o.series.find((s: any) => s.yAxisIndex === 1);
    const left = o.series.find((s: any) => s.yAxisIndex === 0);
    expect(right.type).toBe("line");
    expect(left.type).toBe("bar");
  });
});

describe("specToOption — stacked100", () => {
  it("normalizes to <=100% and keeps raw values for the tooltip", () => {
    const o = opt("stacked100-plan-mix");
    expect(o.yAxis.max).toBe(100);
    const all = o.series.flatMap((s: any) => s.data);
    expect(all.every((d: any) => typeof d === "object" && d.value <= 100 && "raw" in d)).toBe(true);
  });

  it("excludes a combo line from the 100% total so real shares aren't shrunk", () => {
    const spec = resolveSpec(
      {
        rows: [{ month: "2025-01", a: 30, b: 10, target: 1000 }],
        encode: { x: "month", y: ["a", "b"], line: "target" },
      },
      { chartType: "bar", stacking: "stacked100" },
    );
    const o: any = specToOption(spec);
    // series order is [a, b, target(line)]; a + b own 100% between them, the large
    // target line must not dilute it.
    expect(o.series[0].data[0].value).toBe(75); // a: 30 / (30+10)
    expect(o.series[1].data[0].value).toBe(25); // b: 10 / (30+10)
  });
});

describe("specToOption — tooltip XSS escaping (DB/agent values)", () => {
  const evil = "<img src=x onerror=alert(1)>";

  it("pie tooltip escapes the category name", () => {
    const spec = resolveSpec(
      {
        rows: [
          { region: evil, revenue: 10 },
          { region: "US", revenue: 20 },
        ],
      },
      { chartType: "pie" },
    );
    const o: any = specToOption(spec);
    const html = o.tooltip.formatter({ marker: "", name: evil, value: 10, percent: 33 });
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });

  it("funnel tooltip escapes the stage name", () => {
    const spec = resolveSpec(
      {
        rows: [
          { stage: evil, users: 100 },
          { stage: "b", users: 50 },
        ],
      },
      { chartType: "funnel" },
    );
    const o: any = specToOption(spec);
    const html = o.tooltip.formatter({ marker: "", name: evil, value: 100, percent: 50 });
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });

  it("waterfall tooltip escapes the step label from row data", () => {
    const spec = resolveSpec(
      {
        rows: [
          { step: evil, amount: 100 },
          { step: "End", amount: 50 },
        ],
      },
      { chartType: "waterfall" },
    );
    const o: any = specToOption(spec);
    const html = o.tooltip.formatter({ dataIndex: 0 });
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });
});

describe("specToOption — grouped scatter", () => {
  const spec = resolveSpec(
    {
      rows: [
        { customer: "Hooli", segment: "Enterprise", orders: 61, revenue: 354000 },
        { customer: "Globex", segment: "SMB", orders: 18, revenue: 41000 },
        { customer: "Initech", segment: "Enterprise", orders: 27, revenue: 96000 },
      ],
      encode: { x: "orders", y: "revenue", series: "segment" },
    },
    { chartType: "scatter" },
  );

  it("emits one scatter series per group with a legend", () => {
    const o: any = specToOption(spec);
    expect(o.series.map((s: any) => s.type)).toEqual(["scatter", "scatter"]);
    expect(o.series.map((s: any) => s.name).sort()).toEqual(["Enterprise", "SMB"]);
    expect(o.legend).toBeDefined();
  });

  it("packs only a group's own points into its series (sparse y skipped)", () => {
    const o: any = specToOption(spec);
    const ent = o.series.find((s: any) => s.name === "Enterprise");
    const smb = o.series.find((s: any) => s.name === "SMB");
    expect(ent.data.length).toBe(2); // Hooli + Initech
    expect(smb.data.length).toBe(1); // Globex
    expect(ent.data[0][0]).toBe(61); // x = orders
    expect(ent.data[0][1]).toBe(354000); // y = revenue
  });
});
