// Value formatter edge cases: percent auto-scaling and currency compaction.
import { describe, it, expect } from "vitest";
import { fmt, fmtX, compact, fmtAxis } from "../src/format.js";

describe("fmt — percent auto-detect", () => {
  it("treats a fraction (<=1) as a ratio and scales to %", () => {
    expect(fmt(0.42, "percent")).toBe("42.0%");
  });
  it("treats a value >1 as an already-computed percent", () => {
    expect(fmt(42, "percent")).toBe("42.0%"); // not 4200%
  });
  it("honors the per-column fraction flag so a series crossing 1.0 stays consistent", () => {
    expect(fmt(0.98, "percent", undefined, true)).toBe("98.0%");
    expect(fmt(1.02, "percent", undefined, true)).toBe("102.0%"); // not 1.0%
    expect(fmt(0.5, "percent", undefined, false)).toBe("0.5%"); // already-percent column
    expect(fmt(42, "percent", undefined, false)).toBe("42.0%");
  });
});

describe("fmt — currency compaction", () => {
  it("compacts thousands and millions with a symbol", () => {
    expect(fmt(16600, "currency", "USD")).toBe("$16.6K");
    expect(fmt(2_400_000, "currency", "USD")).toBe("$2.4M");
  });
});

describe("fmt — abbreviate=false (tables want exact numbers)", () => {
  it("shows the full number with separators, not K/M", () => {
    expect(fmt(2_400_000, undefined, undefined, undefined, false)).toBe("2,400,000");
    expect(fmt(1_234_567.5, undefined, undefined, undefined, false)).toBe("1,234,567.5");
  });
  it("keeps the currency symbol but not the abbreviation", () => {
    expect(fmt(2_400_000, "currency", "USD", undefined, false)).toBe("$2,400,000");
  });
  it("still abbreviates by default (charts/axes unchanged)", () => {
    expect(fmt(1_234_567.5)).toBe("1.2M"); // non-integer abbreviates
    expect(fmt(2_400_000, "currency", "USD")).toBe("$2.4M"); // currency abbreviates
  });
});

describe("compact — large-magnitude axis notation", () => {
  it("compacts billions, millions, thousands (trailing .0 dropped)", () => {
    expect(compact(8_000_000_000)).toBe("8B");
    expect(compact(1_200_000)).toBe("1.2M");
    expect(compact(3_400_000)).toBe("3.4M");
    expect(compact(1_500)).toBe("1.5K");
    expect(compact(2_000_000_000_000)).toBe("2T");
  });
  it("leaves small magnitudes as exact numbers", () => {
    expect(compact(6)).toBe("6");
    expect(compact(150)).toBe("150");
  });
});

describe("fmtAxis — format-aware compaction", () => {
  it("prefixes a currency symbol on a large currency axis", () => {
    expect(fmtAxis(8_000_000_000, "currency", "USD")).toBe("$8B");
  });
  it("never compacts a percent axis", () => {
    expect(fmtAxis(80, "percent")).toBe("80.0%");
  });
});

describe("fmtX — time labels by granularity", () => {
  it("formats an ISO date as a short month/year, in UTC (no off-by-one)", () => {
    expect(fmtX("2026-04-01", "month")).toBe("Apr 26");
  });
  it("formats a quarter", () => {
    expect(fmtX("2026-04-01", "quarter")).toBe("Q2 26");
  });
  it("passes non-time values through unchanged", () => {
    expect(fmtX(2024, undefined)).toBe("2024");
  });
});
