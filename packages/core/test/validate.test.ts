import { describe, it, expect } from "vitest";
import { warnUntypedColumns } from "../src/validate.js";
import type { ChartData } from "../src/types.js";

describe("warnUntypedColumns", () => {
  it("warns when a column is numbers stored as strings and undeclared", () => {
    const data: ChartData = { rows: [{ month: "2025-01", revenue: "63508.00" }, { month: "2025-02", revenue: "65645.00" }] };
    const warnings = warnUntypedColumns(data);
    expect(warnings.some((w) => w.includes('"revenue"') && w.includes("strings"))).toBe(true);
  });

  it("stays silent when the caller declared the column's kind", () => {
    const data: ChartData = {
      rows: [{ month: "2025-01", revenue: "63508.00" }],
      fields: [{ name: "revenue", kind: "number" }],
    };
    expect(warnUntypedColumns(data)).toEqual([]);
  });

  it("does not flag a 4-digit year-like column (ambiguous, must not force)", () => {
    const data: ChartData = { rows: [{ year: "2024", orders: 10 }, { year: "2025", orders: 12 }] };
    expect(warnUntypedColumns(data)).toEqual([]);
  });

  it("warns on driver wrapper objects but not on Date values", () => {
    const wrapped: ChartData = { rows: [{ day: "2025-01-01", n: { value: 5 } }] };
    expect(warnUntypedColumns(wrapped).some((w) => w.includes('"n"') && w.includes("objects"))).toBe(true);

    const dates: ChartData = { rows: [{ day: new Date("2025-01-01T00:00:00Z"), n: 5 }] };
    expect(warnUntypedColumns(dates)).toEqual([]);
  });

  it("is silent on clean scalar data", () => {
    const data: ChartData = { rows: [{ region: "EU", revenue: 100 }, { region: "US", revenue: 200 }] };
    expect(warnUntypedColumns(data)).toEqual([]);
  });
});
