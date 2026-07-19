// Track A rendering-coverage: assert the high-cardinality caps as structural invariants, so a
// regression that removes a cap (and re-introduces an unreadable chart) fails in CI. These mirror
// the DOM-confirmed thresholds documented in docs/rendering-coverage.md.
import { describe, it, expect } from "vitest";
import { chart } from "../src/dashboard-tool.js";

const cats = (n: number) => Array.from({ length: n }, (_, i) => `Cat${i + 1}`);

describe("high-cardinality caps (rendering invariants)", () => {
  it("bar caps to the top 30 categories and notes the reduction", () => {
    for (const n of [50, 200, 1000]) {
      const rows = cats(n).map((c, i) => ({ cat: c, val: 1000 - i }));
      const spec = chart(rows, { chartType: "bar" });
      expect(spec.data.length).toBe(30);
      expect(spec.notes?.some((m) => /top 30 of \d+/.test(m))).toBe(true);
    }
  });

  it("pie caps to at most 8 slices (folding the tail into Other)", () => {
    for (const n of [50, 200, 1000]) {
      const rows = cats(n).map((c, i) => ({ cat: c, val: Math.max(1, Math.round(500 * Math.exp(-i / (n / 5)))) }));
      const spec = chart(rows, { chartType: "pie" });
      expect(spec.data.length).toBeLessThanOrEqual(8);
    }
  });

  it("line does NOT downsample below 2000 points (1000 renders raw)", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ i, v: Math.sin(i / 8) }));
    const spec = chart(rows, { chartType: "line", encode: { x: "i", y: "v" } });
    expect(spec.data.length).toBe(1000);
  });

  it("scatter passes small clouds through unchanged (1000 < 2000, no cap, no note)", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ x: i, y: (i * 37) % 100 }));
    const spec = chart(rows, { chartType: "scatter" });
    expect(spec.data.length).toBe(1000);
    expect(spec.notes?.some((m) => /sample of/.test(m))).toBeFalsy();
  });

  it("scatter caps/samples above 2000 points and notes the sample", () => {
    for (const n of [2001, 5000, 10000]) {
      const rows = Array.from({ length: n }, (_, i) => ({ x: i, y: (i * 37) % 100 }));
      const spec = chart(rows, { chartType: "scatter" });
      expect(spec.data.length).toBeLessThanOrEqual(2000);
      expect(spec.data.length).toBeGreaterThan(0);
      expect(spec.notes?.some((m) => new RegExp(`sample of \\d+ of ${n} points`).test(m))).toBe(true);
    }
  });

  it("pivot series cap: >12 distinct series fold into Other", () => {
    const rows: Record<string, unknown>[] = [];
    for (const m of ["2025-01", "2025-02", "2025-03"]) {
      for (let s = 0; s < 20; s++) rows.push({ month: m, seg: `S${s}`, v: 20 - s });
    }
    const spec = chart(rows, { chartType: "bar" });
    expect(spec.series.length).toBeLessThanOrEqual(12);
    expect(spec.series.some((s) => s.key === "Other")).toBe(true);
  });
});
