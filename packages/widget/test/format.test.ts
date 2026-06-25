// Value formatter edge cases: percent auto-scaling and currency compaction.
import { describe, it, expect } from "vitest";
import { fmt, fmtX } from "../src/format.js";

describe("fmt — percent auto-detect", () => {
  it("treats a fraction (<=1) as a ratio and scales to %", () => {
    expect(fmt(0.42, "percent")).toBe("42.0%");
  });
  it("treats a value >1 as an already-computed percent", () => {
    expect(fmt(42, "percent")).toBe("42.0%"); // not 4200%
  });
});

describe("fmt — currency compaction", () => {
  it("compacts thousands and millions with a symbol", () => {
    expect(fmt(16600, "currency", "USD")).toBe("$16.6K");
    expect(fmt(2_400_000, "currency", "USD")).toBe("$2.4M");
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
