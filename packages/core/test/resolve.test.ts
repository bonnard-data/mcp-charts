import { describe, it, expect } from "vitest";
import { resolve } from "../src/resolve/resolve.js";
import type { ChartData } from "../src/types.js";

describe("resolve()", () => {
  it("bar: one dimension + one measure -> x=dimension, single series", () => {
    const data: ChartData = {
      rows: [
        { region: "EU", revenue: 29300 },
        { region: "US", revenue: 22500 },
        { region: "APAC", revenue: 300 },
      ],
      fields: [
        { name: "region", role: "dimension", kind: "string" },
        { name: "revenue", role: "measure", kind: "number", format: "currency", currency: "USD" },
      ],
    };
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.chartType).toBe("bar");
    expect(spec.x).toBe("region");
    expect(spec.series).toEqual([{ key: "revenue", label: "Revenue" }]);
    expect(spec.legend).toBe(false);
    expect(spec.yAxis?.format).toBe("currency");
    expect(spec.yAxis?.currency).toBe("USD");
    expect(spec.data.length).toBe(3);
  });

  it("table is a raw grid passthrough: keeps every column, no pivot/series", () => {
    // Raw SQL join (rows only, no declared fields) — the case from the Claude Desktop test.
    const data: ChartData = {
      rows: [
        {
          created_at: "2026-04-08",
          order_id: "o_1001",
          customer: "Hooli",
          region: "EU",
          status: "shipped",
          amount: 4200,
        },
        {
          created_at: "2026-04-14",
          order_id: "o_1010",
          customer: "Globex",
          region: "US",
          status: "open",
          amount: 9100,
        },
      ],
    };
    const spec = resolve(data, { chartType: "table" });
    expect(spec.chartType).toBe("table");
    // All six columns present, in source order — NOT pivoted into order_id columns.
    expect(spec.columns?.map((c) => c.key)).toEqual([
      "created_at",
      "order_id",
      "customer",
      "region",
      "status",
      "amount",
    ]);
    expect(spec.series).toEqual([]);
    expect(spec.x).toBe("");
    expect(spec.data.length).toBe(2);
    // The text columns survive on the rows.
    expect(spec.data[0]).toMatchObject({ customer: "Hooli", region: "EU", status: "shipped" });
  });

  it("auto-detects line when a time field is present", () => {
    const data: ChartData = {
      rows: [
        { month: "2026-01-01", revenue: 100 },
        { month: "2026-02-01", revenue: 200 },
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data);
    expect(spec.chartType).toBe("line");
    expect(spec.x).toBe("month");
    expect(spec.xAxis?.granularity).toBe("month");
  });

  it("pivots time + categorical dimension + one measure into multi-series", () => {
    const data: ChartData = {
      rows: [
        { month: "2026-01-01", region: "EU", revenue: 10 },
        { month: "2026-01-01", region: "US", revenue: 20 },
        { month: "2026-02-01", region: "EU", revenue: 30 },
        { month: "2026-02-01", region: "US", revenue: 40 },
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        { name: "region", role: "dimension", kind: "string" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "line" });
    expect(spec.series.map((s) => s.key).sort()).toEqual(["EU", "US"]);
    expect(spec.legend).toBe(true);
    // wide rows: one per month, with EU + US columns
    const jan = spec.data.find((r) => String(r.month).startsWith("2026-01"));
    expect(jan).toMatchObject({ EU: 10, US: 20 });
  });

  it("pivots a category named like a prototype key without mis-summing (constructor/toString)", () => {
    const data: ChartData = {
      rows: [
        { month: "2026-01-01", plan: "constructor", revenue: 10 },
        { month: "2026-01-01", plan: "toString", revenue: 20 },
        { month: "2026-02-01", plan: "constructor", revenue: 30 },
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        { name: "plan", role: "dimension", kind: "string" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "line" });
    expect(spec.series.map((s) => s.key).sort()).toEqual(["constructor", "toString"]);
    const jan = spec.data.find((r) => String(r.month).startsWith("2026-01"))!;
    expect(jan["constructor"]).toBe(10);
    expect(jan["toString"]).toBe(20);
    // `in` would treat every inherited key as a collision and emit a bogus "Summed rows" note.
    expect((spec.notes ?? []).some((n) => /Summed .* shared the same/.test(n))).toBe(false);
  });

  it("infers types from raw rows when fields are omitted", () => {
    const data: ChartData = {
      rows: [
        { plan: "pro", count: 3 },
        { plan: "free", count: 2 },
      ],
    };
    const spec = resolve(data);
    expect(spec.x).toBe("plan"); // string -> dimension -> x
    expect(spec.series).toEqual([{ key: "count", label: "Count" }]); // number -> measure
    expect(spec.chartType).toBe("bar");
  });

  it("does not type a text column as time/number off one date-shaped first value", () => {
    // Regression: sniffKind trusted only the first non-null value, so "2024" typed the
    // whole id/label column as a time axis.
    const data: ChartData = {
      rows: [
        { label: "2024", n: 1 },
        { label: "kickoff", n: 2 },
        { label: "retro", n: 3 },
      ],
    };
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.x).toBe("label");
    expect(spec.xAxis?.granularity).toBeUndefined(); // string dimension, not a year axis
    expect(spec.data.map((r) => r.label)).toEqual(["2024", "kickoff", "retro"]); // source order kept
  });

  it("single value, no breakdown -> table", () => {
    const data: ChartData = {
      rows: [{ total: 51800 }],
      fields: [{ name: "total", role: "measure", kind: "number", format: "currency" }],
    };
    const spec = resolve(data);
    expect(spec.chartType).toBe("table");
    expect(spec.x).toBe("");
  });

  it("respects an explicit encode override", () => {
    const data: ChartData = {
      rows: [
        { a: "x", b: 1, c: 10 },
        { a: "y", b: 2, c: 20 },
      ],
      encode: { x: "a", y: "c" },
    };
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.x).toBe("a");
    expect(spec.series).toEqual([{ key: "c", label: "C" }]);
  });

  it("pie drops non-positive slices", () => {
    const data: ChartData = {
      rows: [
        { region: "EU", revenue: 100 },
        { region: "US", revenue: 0 },
        { region: "APAC", revenue: -5 },
      ],
      fields: [
        { name: "region", role: "dimension", kind: "string" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "pie" });
    expect(spec.data.map((r) => r.region)).toEqual(["EU"]);
  });

  it("produces a JSON-serializable spec (no functions)", () => {
    const data: ChartData = {
      rows: [{ region: "EU", revenue: 1 }],
      fields: [
        { name: "region", role: "dimension", kind: "string" },
        { name: "revenue", role: "measure", kind: "number", format: "currency" },
      ],
    };
    const spec = resolve(data, { chartType: "bar", title: "Rev" });
    expect(() => JSON.parse(JSON.stringify(spec))).not.toThrow();
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
  });
});

describe("resolve() — P0.1 auto-aggregate unaggregated data", () => {
  it("sums duplicate x rows (no pivot) into one row per category", () => {
    // Unaggregated: 4 rows across 2 statuses (no GROUP BY).
    const data: ChartData = {
      rows: [
        { status: "shipped", amount: 100 },
        { status: "open", amount: 30 },
        { status: "shipped", amount: 250 },
        { status: "open", amount: 20 },
      ],
      fields: [
        { name: "status", role: "dimension", kind: "string" },
        { name: "amount", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.data.length).toBe(2);
    expect(spec.data.find((r) => r.status === "shipped")?.amount).toBe(350);
    expect(spec.data.find((r) => r.status === "open")?.amount).toBe(50);
    expect(spec.notes?.[0]).toMatch(/Summed 2 row\(s\).*status/);
  });

  it("does NOT add a note when the data is already aggregated", () => {
    const data: ChartData = {
      rows: [
        { status: "shipped", amount: 350 },
        { status: "open", amount: 50 },
      ],
      fields: [
        { name: "status", role: "dimension", kind: "string" },
        { name: "amount", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.notes).toBeUndefined();
  });

  it("sums duplicate (x, series) cells on the pivot path instead of last-write-wins", () => {
    const data: ChartData = {
      rows: [
        { month: "2026-01-01", region: "EU", revenue: 100 },
        { month: "2026-01-01", region: "EU", revenue: 50 }, // duplicate (x, series)
        { month: "2026-01-01", region: "US", revenue: 200 },
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        { name: "region", role: "dimension", kind: "string" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "line" });
    const jan = spec.data.find((r) => String(r.month).startsWith("2026-01"));
    expect(jan?.EU).toBe(150); // 100 + 50, not 50 (last-write-wins)
    expect(jan?.US).toBe(200);
    expect(spec.notes?.[0]).toMatch(/Summed 1 row\(s\).*region/);
  });
});

describe("resolve() — P1 sort / pie Other / stacked fill", () => {
  it("sorts an unordered time x ascending", () => {
    const data: ChartData = {
      rows: [
        { month: "2026-03-01", revenue: 30 },
        { month: "2026-01-01", revenue: 10 },
        { month: "2026-02-01", revenue: 20 },
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "line" });
    expect(spec.data.map((r) => r.revenue)).toEqual([10, 20, 30]);
  });

  it("sorts an unordered numeric x ascending", () => {
    const data: ChartData = {
      rows: [
        { bucket: 30, n: 3 },
        { bucket: 10, n: 1 },
        { bucket: 20, n: 2 },
      ],
    };
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.x).toBe("bucket");
    expect(spec.data.map((r) => r.bucket)).toEqual([10, 20, 30]);
  });

  it("leaves a string category x in source order", () => {
    const data: ChartData = {
      rows: [
        { stage: "C", n: 3 },
        { stage: "A", n: 1 },
        { stage: "B", n: 2 },
      ],
      fields: [
        { name: "stage", role: "dimension", kind: "string" },
        { name: "n", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.data.map((r) => r.stage)).toEqual(["C", "A", "B"]);
  });

  it("pie: folds a long tail (>8 slices) into one 'Other', largest-first", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ cat: `c${i}`, val: 12 - i }));
    const spec = resolve(
      {
        rows,
        fields: [
          { name: "cat", role: "dimension", kind: "string" },
          { name: "val", role: "measure", kind: "number" },
        ],
      },
      { chartType: "pie" },
    );
    expect(spec.data.length).toBe(8); // 7 top + "Other"
    expect(spec.data.at(-1)?.cat).toBe("Other");
    // Other = sum of the 5 smallest (val 5,4,3,2,1) = 15
    expect(spec.data.at(-1)?.val).toBe(15);
    expect(spec.data[0]?.val).toBe(12); // largest first
    expect(spec.notes?.some((n) => /Other/.test(n))).toBe(true);
  });

  it("pie: folds sub-2% slivers into 'Other' even under the slice-count cap", () => {
    // The real degraded case: a handful of big slices + two sub-1% slivers.
    const rows = [
      { cat: "A", val: 300 },
      { cat: "B", val: 260 },
      { cat: "C", val: 200 },
      { cat: "D", val: 120 },
      { cat: "E", val: 100 },
      { cat: "F", val: 5 }, // ~0.5%
      { cat: "G", val: 4 }, // ~0.4%
    ];
    const spec = resolve(
      {
        rows,
        fields: [
          { name: "cat", role: "dimension", kind: "string" },
          { name: "val", role: "measure", kind: "number" },
        ],
      },
      { chartType: "pie" },
    );
    expect(spec.data.length).toBe(6); // A–E + Other
    expect(spec.data.find((r) => r.cat === "Other")?.val).toBe(9);
  });

  it("pie: a single small slice is NOT bucketed (matches BI norms)", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ cat: `c${i}`, val: 8 - i }));
    const spec = resolve(
      {
        rows,
        fields: [
          { name: "cat", role: "dimension", kind: "string" },
          { name: "val", role: "measure", kind: "number" },
        ],
      },
      { chartType: "pie" },
    );
    expect(spec.data.length).toBe(8);
    expect(spec.data.some((r) => r.cat === "Other")).toBe(false);
  });

  it("stacked: zero-fills missing (x, series) cells so stacks align", () => {
    const data: ChartData = {
      encode: { x: "region", series: "plan" },
      rows: [
        { region: "EU", plan: "enterprise", revenue: 100 },
        { region: "EU", plan: "pro", revenue: 50 },
        { region: "US", plan: "enterprise", revenue: 80 }, // US has no "pro"
      ],
      fields: [
        { name: "region", role: "dimension", kind: "string" },
        { name: "plan", role: "dimension", kind: "string" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "bar", stacking: "stacked" });
    const us = spec.data.find((r) => r.region === "US");
    expect(us?.pro).toBe(0); // explicitly 0-filled, not undefined
  });
});

describe("resolve() — edge cases", () => {
  it("fills missing time intervals with null-measure gap rows", () => {
    const data: ChartData = {
      rows: [
        { month: "2026-01-01", revenue: 10 },
        { month: "2026-03-01", revenue: 30 }, // Feb missing
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "line" });
    expect(spec.data.length).toBe(3); // Jan, Feb (filled), Mar
    const feb = spec.data[1]!;
    expect(String(feb.month)).toContain("2026-02");
    expect(feb.revenue).toBeNull(); // a gap, not 0
  });

  it("keeps rows whose timestamps are not midnight-aligned when filling time gaps", () => {
    // Regression: dateKey included the hour, so a 14:30 bucket never matched the midnight
    // sequence and every real row was silently replaced by a null gap row.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      day: `2025-01-${String(i + 5).padStart(2, "0")} 14:30:00`,
      revenue: (i + 1) * 10,
    }));
    const data: ChartData = {
      rows,
      fields: [
        { name: "day", role: "time", kind: "time", granularity: "day" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "line" });
    expect(spec.data.length).toBe(10);
    expect(spec.data.map((r) => r.revenue)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it("fills gaps around non-midnight timestamps without dropping the real rows", () => {
    const data: ChartData = {
      rows: [
        { day: "2025-01-05 14:30:00", revenue: 10 },
        { day: "2025-01-07 09:15:00", revenue: 30 }, // Jan 6 missing
      ],
      fields: [
        { name: "day", role: "time", kind: "time", granularity: "day" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "line" });
    expect(spec.data.length).toBe(3);
    expect(spec.data.map((r) => r.revenue)).toEqual([10, null, 30]);
  });

  it("labels a null/empty dimension value as '(No value)'", () => {
    const data: ChartData = {
      rows: [
        { region: "EU", revenue: 10 },
        { region: null, revenue: 5 },
        { region: "", revenue: 2 },
      ],
      fields: [
        { name: "region", role: "dimension", kind: "string" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.data.filter((r) => r.region === "(No value)").length).toBeGreaterThan(0);
  });

  it("renders a boolean dimension as Yes / No", () => {
    const data: ChartData = {
      rows: [
        { is_paid: true, n: 7 },
        { is_paid: false, n: 3 },
      ],
      fields: [
        { name: "is_paid", role: "dimension", kind: "boolean" },
        { name: "n", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.data.map((r) => r.is_paid).sort()).toEqual(["No", "Yes"]);
  });

  it("leaves a category bar vertical whatever the row count", () => {
    const many: ChartData = {
      rows: Array.from({ length: 10 }, (_, i) => ({ name: `cust ${i}`, revenue: 100 - i })),
      fields: [
        { name: "name", role: "dimension", kind: "string" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    expect(resolve(many, { chartType: "bar" }).horizontal).toBeUndefined();
    const few: ChartData = {
      rows: [
        { name: "a", revenue: 1 },
        { name: "b", revenue: 2 },
      ],
      fields: [
        { name: "name", role: "dimension", kind: "string" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    expect(resolve(few, { chartType: "bar" }).horizontal).toBeUndefined();
    expect(resolve(many, { chartType: "bar", horizontal: true }).horizontal).toBe(true);
  });
});

describe("resolve() — high-cardinality guardrails", () => {
  it("caps a high-cardinality bar to the top 30 by value (drops the tail, with a note)", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ item: `item ${i}`, value: i + 1 }));
    const spec = resolve(
      {
        rows,
        fields: [
          { name: "item", role: "dimension", kind: "string" },
          { name: "value", role: "measure", kind: "number" },
        ],
      },
      { chartType: "bar" },
    );
    expect(spec.data.length).toBe(30);
    expect(Math.min(...spec.data.map((r) => Number(r.value)))).toBe(21); // kept the largest 30 (21..50)
    expect(spec.notes?.some((n) => /top 30 of 50/.test(n))).toBe(true);
  });

  it("caps high-cardinality pivot series, folding the rest into an 'Other' series", () => {
    const rows = Array.from({ length: 20 }, (_, s) => ({ month: "2026-01-01", grp: `g${s}`, val: s + 1 }));
    const spec = resolve(
      {
        encode: { x: "month", series: "grp" },
        rows,
        fields: [
          { name: "month", role: "time", kind: "time", granularity: "month" },
          { name: "grp", role: "dimension", kind: "string" },
          { name: "val", role: "measure", kind: "number" },
        ],
      },
      { chartType: "bar" },
    );
    expect(spec.series.length).toBe(12); // 11 kept + Other
    expect(spec.series.at(-1)?.key).toBe("Other");
    expect(spec.data[0]!.Other).toBe(45); // sum of the 9 smallest series (1..9)
    expect(spec.notes?.some((n) => /Other/.test(n))).toBe(true);
  });

  it("flags numeric (non-time) x as numeric for a linear axis", () => {
    const data: ChartData = {
      rows: [
        { step: 1, y: 10 },
        { step: 5, y: 30 },
        { step: 100, y: 20 }, // irregular spacing
      ],
      fields: [
        { name: "step", role: "dimension", kind: "number" },
        { name: "y", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "line" });
    expect(spec.x).toBe("step");
    expect(spec.xAxis?.numeric).toBe(true);
    expect(spec.data.length).toBe(3);
  });

  describe("xAxisType override", () => {
    const yearly: ChartData = {
      rows: [
        { year: 2017, orders: 120 },
        { year: 2018, orders: 180 },
        { year: 2026, orders: 240 },
      ],
      fields: [
        { name: "year", role: "dimension", kind: "number" },
        { name: "orders", role: "measure", kind: "number" },
      ],
    };

    it('"categorical" suppresses the numeric axis on a numeric column', () => {
      const spec = resolve(yearly, { chartType: "line", xAxisType: "categorical" });
      expect(spec.x).toBe("year");
      expect(spec.xAxis?.numeric).toBeUndefined();
      expect(spec.xAxis?.label).toBe("Year");
    });

    it('"continuous" forces the numeric axis on a low-cardinality numeric column', () => {
      const spec = resolve(yearly, { chartType: "line", xAxisType: "continuous" });
      expect(spec.xAxis?.numeric).toBe(true);
    });

    it('"continuous" forces the numeric axis on a string column', () => {
      const spec = resolve(
        {
          rows: [
            { bucket: "10", v: 1 },
            { bucket: "20", v: 2 },
          ],
          fields: [
            { name: "bucket", role: "dimension", kind: "string" },
            { name: "v", role: "measure", kind: "number" },
          ],
        },
        { chartType: "line", xAxisType: "continuous" },
      );
      expect(spec.xAxis?.numeric).toBe(true);
    });

    it("no override keeps the inferred behavior on both a numeric and a string x", () => {
      expect(resolve(yearly, { chartType: "line" }).xAxis?.numeric).toBe(true);
      const strings = resolve(
        {
          rows: [
            { region: "EU", revenue: 10 },
            { region: "US", revenue: 20 },
          ],
          fields: [
            { name: "region", role: "dimension", kind: "string" },
            { name: "revenue", role: "measure", kind: "number" },
          ],
        },
        { chartType: "bar" },
      );
      expect(strings.xAxis?.numeric).toBeUndefined();
    });
  });

  it("stride-downsamples a >2000-point line, keeping the last point", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      day: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
      v: i,
    }));
    const spec = resolve(
      {
        rows,
        fields: [
          { name: "day", role: "time", kind: "time" },
          { name: "v", role: "measure", kind: "number" },
        ],
      },
      { chartType: "line" },
    );
    expect(spec.data.length).toBeLessThanOrEqual(2001);
    expect(spec.data.length).toBeGreaterThan(1000);
    expect(spec.data.at(-1)?.v).toBe(4999); // last point preserved (range intact)
    expect(spec.notes?.some((n) => /Downsampled 5000/.test(n))).toBe(true);
  });

  it("does NOT cap a dense line (many time points are legitimate)", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      day: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      revenue: i + 1,
    }));
    const spec = resolve(
      {
        rows,
        fields: [
          { name: "day", role: "time", kind: "time" },
          { name: "revenue", role: "measure", kind: "number" },
        ],
      },
      { chartType: "line" },
    );
    expect(spec.data.length).toBe(60); // all points kept
  });
});

describe("resolve() — dual-axis (encode.y2)", () => {
  it("assigns y2 measures to a secondary right axis with their own format", () => {
    const data: ChartData = {
      encode: { y2: "margin_pct" },
      rows: [
        { month: "2026-04-01", revenue: 100, margin_pct: 0.42 },
        { month: "2026-05-01", revenue: 120, margin_pct: 0.4 },
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        { name: "revenue", role: "measure", kind: "number", format: "currency", currency: "USD" },
        { name: "margin_pct", role: "measure", kind: "number", format: "percent" },
      ],
    };
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.series.find((s) => s.key === "revenue")?.axis).toBeUndefined(); // left (default)
    expect(spec.series.find((s) => s.key === "margin_pct")?.axis).toBe("right");
    expect(spec.yAxis?.format).toBe("currency");
    expect(spec.yAxisRight?.format).toBe("percent");
  });
});

describe("resolve() — P2 polish", () => {
  it("pie: all-negative values plot as magnitudes, with a note", () => {
    const data: ChartData = {
      rows: [
        { account: "A", balance: -300 },
        { account: "B", balance: -100 },
      ],
      fields: [
        { name: "account", role: "dimension", kind: "string" },
        { name: "balance", role: "measure", kind: "number" },
      ],
    };
    const spec = resolve(data, { chartType: "pie" });
    expect(spec.data.length).toBe(2);
    expect(spec.data.map((r) => r.balance)).toEqual([300, 100]); // magnitudes, largest first
    expect(spec.notes?.some((n) => /negative/.test(n))).toBe(true);
  });

  it("throws a clear error when the x column is entirely null", () => {
    const data: ChartData = {
      rows: [
        { region: null, revenue: 10 },
        { region: null, revenue: 20 },
      ],
      fields: [
        { name: "region", role: "dimension", kind: "string" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
    };
    expect(() => resolve(data, { chartType: "bar" })).toThrow(/entirely empty/);
  });
});

describe("resolve() — P0.2 numeric grouping column", () => {
  it("treats a numeric grouping column as the x dimension, not a second measure/table", () => {
    // {year, revenue}: both numeric. Should chart revenue over year, not fall back to a table.
    const data: ChartData = {
      rows: [
        { year: 2024, revenue: 100 },
        { year: 2025, revenue: 180 },
        { year: 2026, revenue: 150 },
      ],
    };
    const spec = resolve(data); // auto-detect
    expect(spec.chartType).not.toBe("table");
    expect(spec.x).toBe("year");
    expect(spec.series.map((s) => s.key)).toEqual(["revenue"]);
    expect(spec.data.length).toBe(3);
  });

  it("picks the lower-cardinality numeric as x when distinct counts differ", () => {
    // age has 2 distinct, score has 4 -> age is the grouping dimension.
    const data: ChartData = {
      rows: [
        { age: 30, score: 11 },
        { age: 30, score: 22 },
        { age: 40, score: 33 },
        { age: 40, score: 44 },
      ],
    };
    const spec = resolve(data);
    expect(spec.x).toBe("age");
    // age 30 -> 11+22=33, age 40 -> 33+44=77 (also exercises duplicate-x aggregation)
    expect(spec.data.find((r) => r.age === 30)?.score).toBe(33);
  });

  it("a single all-numeric row stays a table (KPI), not a promoted x", () => {
    const spec = resolve({ rows: [{ revenue: 500, orders: 12 }] });
    expect(spec.chartType).toBe("table");
  });

  describe("temporal detection + orientation (raw-SQL path)", () => {
    const monthlyRows = Array.from({ length: 18 }, (_, i) => ({
      month: `2025-${String((i % 12) + 1).padStart(2, "0")}`, // YYYY-MM strings (strftime output)
      revenue: 100 + i,
    }));

    it("types a YYYY-MM string column as time with month granularity (not a category)", () => {
      const spec = resolve({ rows: monthlyRows.slice(0, 3) });
      expect(spec.x).toBe("month");
      expect(spec.xAxis?.granularity).toBe("month");
      expect(spec.chartType).toBe("line"); // a time axis auto-detects to line
    });

    it("infers month granularity from date_trunc-style full dates (all first-of-month)", () => {
      // date_trunc('month', ...) yields full dates; shape-sniffing one value said "day",
      // which null-filled a monthly series into ~30x disconnected dots.
      const rows = Array.from({ length: 6 }, (_, i) => ({
        month: `2025-${String(i + 1).padStart(2, "0")}-01`,
        revenue: 100 + i,
      }));
      const spec = resolve({ rows }, { chartType: "line" });
      expect(spec.xAxis?.granularity).toBe("month");
      expect(spec.data.length).toBe(6); // no day-fill explosion
    });

    it("infers year / quarter / week / day granularity from the value pattern", () => {
      const gran = (dates: string[]) =>
        resolve({ rows: dates.map((d, i) => ({ ts: d, v: i + 1 })) }, { chartType: "line" }).xAxis?.granularity;
      expect(gran(["2023-01-01", "2024-01-01", "2025-01-01"])).toBe("year");
      expect(gran(["2025-01-01", "2025-04-01", "2025-07-01"])).toBe("quarter");
      expect(gran(["2025-01-06", "2025-01-13", "2025-01-20"])).toBe("week"); // all Mondays
      expect(gran(["2025-01-05", "2025-01-06", "2025-01-07"])).toBe("day");
    });

    it("does NOT auto-horizontal a time-bucketed bar, even with many buckets", () => {
      const spec = resolve({ rows: monthlyRows }, { chartType: "bar" }); // 18 months
      expect(spec.horizontal).toBeUndefined(); // time x stays vertical
    });

    it("does NOT auto-horizontal a high-cardinality CATEGORICAL bar", () => {
      const rows = Array.from({ length: 12 }, (_, i) => ({ product: `Product ${i}`, revenue: 100 - i }));
      const spec = resolve({ rows }, { chartType: "bar" });
      expect(spec.horizontal).toBeUndefined();
    });

    // The reported bug: 12 month buckets in a declared-string column rendered sideways.
    it("keeps a 12-row declared-string bar vertical", () => {
      const rows = Array.from({ length: 12 }, (_, i) => ({
        month: `2026-${String(i + 1).padStart(2, "0")}`,
        revenue: 100 + i,
      }));
      const spec = resolve(
        {
          rows,
          fields: [
            { name: "month", role: "dimension", kind: "string" },
            { name: "revenue", role: "measure", kind: "number" },
          ],
        },
        { chartType: "bar" },
      );
      expect(spec.horizontal).toBeUndefined();
      expect(spec.data.length).toBe(12); // no reordering or gap-filling either
    });

    it("honours an explicit horizontal: true on the same 12-row shape", () => {
      const rows = Array.from({ length: 12 }, (_, i) => ({
        month: `2026-${String(i + 1).padStart(2, "0")}`,
        revenue: 100 + i,
      }));
      const data: ChartData = {
        rows,
        fields: [
          { name: "month", role: "dimension", kind: "string" },
          { name: "revenue", role: "measure", kind: "number" },
        ],
      };
      expect(resolve(data, { chartType: "bar", horizontal: true }).horizontal).toBe(true);
      expect(resolve(data, { chartType: "bar", horizontal: false }).horizontal).toBe(false);
    });

    it("never renders a same-axis combo horizontal (even when asked)", () => {
      const rows = Array.from({ length: 12 }, (_, i) => ({ name: `Cat ${i}`, revenue: 100 - i, target: 90 }));
      const spec = resolve(
        { rows, encode: { y: ["revenue", "target"], line: "target" } },
        { chartType: "bar", horizontal: true },
      );
      expect(spec.series.find((s) => s.key === "target")?.type).toBe("line");
      expect(spec.horizontal).toBe(false); // combo forced vertical
    });

    describe("encode.line is additive (x / y / line each name their own column)", () => {
      const rows = [
        { month: "2025-01", revenue: 100, forecast: 120 },
        { month: "2025-02", revenue: 140, forecast: 130 },
      ];

      it("plots a line measure that wasn't listed in y", () => {
        const spec = resolve({ rows, encode: { x: "month", y: "revenue", line: "forecast" } }, { chartType: "bar" });
        expect(spec.series.map((s) => s.key)).toEqual(["revenue", "forecast"]);
        expect(spec.series.find((s) => s.key === "forecast")?.type).toBe("line");
        expect(spec.series.find((s) => s.key === "revenue")?.type).toBeUndefined(); // stays a bar
      });

      it("does not duplicate a line measure already in y (just tags it)", () => {
        const spec = resolve(
          { rows, encode: { x: "month", y: ["revenue", "forecast"], line: "forecast" } },
          { chartType: "bar" },
        );
        expect(spec.series.filter((s) => s.key === "forecast").length).toBe(1);
        expect(spec.series.find((s) => s.key === "forecast")?.type).toBe("line");
      });

      it("ignores a line name that isn't a real column (no phantom series)", () => {
        const spec = resolve({ rows, encode: { x: "month", y: "revenue", line: "nope" } }, { chartType: "bar" });
        expect(spec.series.map((s) => s.key)).toEqual(["revenue"]);
      });
    });
  });

  describe("scatter / bubble", () => {
    const rows = [
      { customer: "Hooli", orders: 61, revenue: 354000, aov: 5803 },
      { customer: "Globex", orders: 18, revenue: 41000, aov: 2278 },
      { customer: "Initech", orders: 27, revenue: 96000, aov: 3556 },
    ];

    it("treats x and y as measures, keeps every row (no aggregation), numeric x axis", () => {
      const spec = resolve({ rows }, { chartType: "scatter" });
      expect(spec.chartType).toBe("scatter");
      expect(spec.x).toBe("orders"); // first measure
      expect(spec.series).toEqual([{ key: "revenue", label: "Revenue" }]); // second measure
      expect(spec.data.length).toBe(3); // not collapsed
      expect(spec.xAxis?.numeric).toBe(true);
      expect(spec.pointLabel).toBe("customer"); // the dimension labels points
    });

    it("encode.size turns it into a bubble", () => {
      const spec = resolve({ rows, encode: { x: "orders", y: "revenue", size: "aov" } }, { chartType: "scatter" });
      expect(spec.size).toBe("aov");
    });

    it("encode.series groups points into one colored series per category", () => {
      const grouped = [
        { customer: "Hooli", segment: "Enterprise", orders: 61, revenue: 354000 },
        { customer: "Globex", segment: "SMB", orders: 18, revenue: 41000 },
        { customer: "Initech", segment: "Enterprise", orders: 27, revenue: 96000 },
      ];
      const spec = resolve(
        { rows: grouped, encode: { x: "orders", y: "revenue", series: "segment" } },
        { chartType: "scatter" },
      );
      expect(spec.series.map((s) => s.key).sort()).toEqual(["Enterprise", "SMB"]);
      expect(spec.legend).toBe(true);
      expect(spec.pointLabel).toBe("customer"); // the label dimension, not the grouping one
      // each point's y lands in its own group column; x stays shared
      const hooli = spec.data.find((r) => r.customer === "Hooli")!;
      expect(hooli.orders).toBe(61);
      expect(hooli.Enterprise).toBe(354000);
      expect(hooli.SMB).toBeUndefined();
    });

    it("ignores a numeric encode.series (a point cloud can't group by a measure)", () => {
      const spec = resolve({ rows, encode: { x: "orders", y: "revenue", series: "aov" } }, { chartType: "scatter" });
      expect(spec.series).toEqual([{ key: "revenue", label: "Revenue" }]);
      expect(spec.legend).toBe(false);
    });

    it('folds categories beyond the series cap into "Other"', () => {
      const many = Array.from({ length: 15 }, (_, i) => ({
        customer: `c${i}`,
        segment: `S${i}`,
        orders: i + 1,
        revenue: (i + 1) * 1000,
      }));
      const spec = resolve(
        { rows: many, encode: { x: "orders", y: "revenue", series: "segment" } },
        { chartType: "scatter" },
      );
      expect(spec.series.length).toBe(12); // MAX_SERIES
      expect(spec.series.some((s) => s.key === "Other")).toBe(true);
      expect(spec.notes?.some((n) => /Other/.test(n))).toBe(true);
    });

    it("throws an instructive error when there aren't two numeric columns", () => {
      expect(() => resolve({ rows: [{ name: "A", region: "EU" }] }, { chartType: "scatter" })).toThrow(
        /two numeric|numeric/i,
      );
    });
  });

  describe("funnel", () => {
    it("a stage dimension + a value -> funnel spec (no axes)", () => {
      const spec = resolve(
        {
          rows: [
            { stage: "Visitors", users: 12000 },
            { stage: "Signups", users: 4200 },
            { stage: "Paid", users: 760 },
          ],
        },
        { chartType: "funnel" },
      );
      expect(spec.chartType).toBe("funnel");
      expect(spec.x).toBe("stage");
      expect(spec.series).toEqual([{ key: "users", label: "Users" }]);
      expect(spec.data.length).toBe(3);
      expect(spec.xAxis).toBeUndefined(); // funnels have no axes
    });

    it("drops non-positive stages", () => {
      const spec = resolve(
        {
          rows: [
            { stage: "A", n: 100 },
            { stage: "B", n: 0 },
            { stage: "C", n: -5 },
          ],
        },
        { chartType: "funnel" },
      );
      expect(spec.data.length).toBe(1);
    });
  });

  describe("waterfall", () => {
    const bridge = [
      { step: "Opening", amount: 1800000 },
      { step: "New", amount: 420000 },
      { step: "Churn", amount: -240000 },
      { step: "Closing", amount: 2070000 },
    ];

    it("step + signed amount -> waterfall; first & last are totals by convention", () => {
      const spec = resolve({ rows: bridge }, { chartType: "waterfall" });
      expect(spec.chartType).toBe("waterfall");
      expect(spec.x).toBe("step");
      expect(spec.series).toEqual([{ key: "amount", label: "Amount" }]);
      expect(spec.totals).toEqual(["Opening", "Closing"]);
      expect(spec.data.length).toBe(4);
    });

    it("uses a marker column (kind=total) to identify totals when present", () => {
      const rows = [
        { step: "Opening", kind: "total", amount: 100 },
        { step: "Up", kind: "delta", amount: 50 },
        { step: "Closing", kind: "total", amount: 150 },
      ];
      const spec = resolve({ rows }, { chartType: "waterfall" });
      expect(spec.totals).toEqual(["Opening", "Closing"]);
    });

    it("throws an instructive error when there's no step + value", () => {
      expect(() => resolve({ rows: [{ onlyText: "x" }, { onlyText: "y" }] }, { chartType: "waterfall" })).toThrow(
        /waterfall|signed/i,
      );
    });
  });
});

describe("resolve() — name-based format inference (raw-rows path)", () => {
  it("a *_rate numeric column gets percent format with no declared fields", () => {
    const data: ChartData = {
      rows: [
        { month: "2026-01", completion_rate: 0.23 },
        { month: "2026-02", completion_rate: 0.41 },
      ],
    };
    const spec = resolve(data, { chartType: "line" });
    const rateCol = spec.columns?.find((c) => c.key === "completion_rate");
    expect(spec.yAxis?.format ?? rateCol?.format).toBe("percent");
  });

  it("a plain numeric column is not formatted as percent", () => {
    const data: ChartData = {
      rows: [
        { region: "EU", revenue: 100 },
        { region: "US", revenue: 250 },
      ],
    };
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.yAxis?.format).toBeUndefined();
  });

  it("declared format still wins over the name heuristic", () => {
    const data: ChartData = {
      rows: [{ month: "2026-01", growth_rate: 1200 }],
      fields: [{ name: "growth_rate", kind: "number", format: "currency", currency: "USD" }],
    };
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.yAxis?.format).toBe("currency");
  });

  it("does not percent-format a *_rate column whose values aren't fractions (exchange_rate)", () => {
    const data: ChartData = {
      rows: [
        { month: "2026-01", exchange_rate: 1.08 },
        { month: "2026-02", exchange_rate: 1.12 },
      ],
    };
    const spec = resolve(data, { chartType: "line" });
    expect(spec.yAxis?.format).toBeUndefined(); // 1.08 must never render as 108%
    expect(spec.columns?.find((c) => c.key === "exchange_rate")?.format).toBeUndefined();
  });
});

describe("resolve() — ChartData.notes passthrough", () => {
  const fields: ChartData["fields"] = [
    { name: "region", role: "dimension", kind: "string" },
    { name: "revenue", role: "measure", kind: "number" },
  ];
  const rows = [
    { region: "EU", revenue: 10 },
    { region: "US", revenue: 20 },
  ];

  it("merges data-source notes (e.g. a truncation warning) into ChartSpec.notes", () => {
    const spec = resolve({ rows, fields, notes: ["Result truncated at 5000 rows."] }, { chartType: "bar" });
    expect(spec.notes).toEqual(["Result truncated at 5000 rows."]);
  });

  it("keeps source notes ahead of resolve's own notes", () => {
    const dup = [...rows, { region: "EU", revenue: 5 }]; // triggers the summed-duplicates note
    const spec = resolve({ rows: dup, fields, notes: ["Result truncated."] }, { chartType: "bar" });
    expect(spec.notes?.[0]).toBe("Result truncated.");
    expect(spec.notes?.some((n) => /Summed/.test(n))).toBe(true);
  });

  it("carries notes on the table branch too", () => {
    const spec = resolve({ rows, fields, notes: ["Result truncated."] }, { chartType: "table" });
    expect(spec.notes).toEqual(["Result truncated."]);
  });
});

describe("resolve() — percent scale decided once per column", () => {
  it("flags a 0-1 fraction series crossing 1.0 as fraction (no per-value scale flips)", () => {
    const data: ChartData = {
      rows: [
        { month: "2026-01-01", sla: 0.98 },
        { month: "2026-02-01", sla: 1.02 },
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        { name: "sla", role: "measure", kind: "number", format: "percent" },
      ],
    };
    const spec = resolve(data, { chartType: "line" });
    expect(spec.yAxis?.fraction).toBe(true); // 0.98 -> 98%, 1.02 -> 102% (not 1%)
    expect(spec.columns?.find((c) => c.key === "sla")?.fraction).toBe(true);
  });

  it("flags an already-percent series (values in 0-100) as non-fraction", () => {
    const data: ChartData = {
      rows: [
        { month: "2026-01-01", pct_complete: 42 },
        { month: "2026-02-01", pct_complete: 55 },
      ],
    };
    const spec = resolve(data, { chartType: "line" });
    expect(spec.yAxis?.format).toBe("percent"); // pct name hint
    expect(spec.yAxis?.fraction).toBe(false);
  });
});

describe("resolve() — transparency notes (talk back, never silent)", () => {
  const hasNote = (spec: { notes?: string[] }, re: RegExp) => (spec.notes ?? []).some((n) => re.test(n));

  it("flags an encode column that does not exist instead of dropping it", () => {
    const spec = resolve(
      {
        rows: [
          { month: "2026-01", revenue: 10 },
          { month: "2026-02", revenue: 20 },
        ],
        encode: { x: "month", series: "regionn" },
      },
      { chartType: "bar" },
    );
    expect(hasNote(spec, /Ignored unknown encode column "regionn"/)).toBe(true);
    expect(hasNote(spec, /available:.*month.*revenue/)).toBe(true);
  });

  it("notes that y2 is dropped when the chart is also split into series", () => {
    const spec = resolve(
      {
        rows: [
          { month: "2026-01-01", region: "EU", revenue: 10, margin: 0.3 },
          { month: "2026-01-01", region: "US", revenue: 20, margin: 0.4 },
          { month: "2026-02-01", region: "EU", revenue: 30, margin: 0.5 },
        ],
        fields: [
          { name: "month", role: "time", kind: "time", granularity: "month" },
          { name: "region", role: "dimension", kind: "string" },
          { name: "revenue", role: "measure", kind: "number" },
          { name: "margin", role: "measure", kind: "number" },
        ],
        encode: { series: "region", y2: "margin" },
      },
      { chartType: "bar" },
    );
    expect(hasNote(spec, /"margin" were dropped because the chart is split into series/)).toBe(true);
  });

  it("warns when it sums a rate column across duplicate x rows", () => {
    const spec = resolve(
      {
        rows: [
          { region: "EU", revenue: 10, refund_rate: 0.1 },
          { region: "EU", revenue: 20, refund_rate: 0.2 },
          { region: "US", revenue: 5, refund_rate: 0.05 },
        ],
      },
      { chartType: "bar" },
    );
    expect(hasNote(spec, /summing rates is usually wrong/)).toBe(true);
  });

  it("says when a waterfall guessed the opening/closing totals", () => {
    const guessed = resolve(
      {
        rows: [
          { step: "Open", delta: 100 },
          { step: "Gain", delta: 50 },
          { step: "Close", delta: -20 },
        ],
      },
      { chartType: "waterfall" },
    );
    expect(hasNote(guessed, /No totals column found/)).toBe(true);

    const marked = resolve(
      {
        rows: [
          { step: "Open", type: "total", delta: 1800 },
          { step: "Gain", type: "delta", delta: 420 },
          { step: "Close", type: "total", delta: 2220 },
        ],
      },
      { chartType: "waterfall" },
    );
    expect(hasNote(marked, /No totals column found/)).toBe(false);
  });
});
