// Decisions: the structured form of resolve()'s advisories. `notes` stays the flat projection, so
// every test here also asserts the two agree.
import { describe, it, expect } from "vitest";
import { resolve } from "../src/resolve/resolve.js";
import { chart, explain } from "../src/views.js";
import type { ChartData, Decision, DecisionAudience } from "../src/types.js";

const find = (spec: { decisions?: Decision[] }, kind: string): Decision | undefined =>
  spec.decisions?.find((d) => d.kind === kind);

describe("Decision shape", () => {
  it("carries kind, audiences, message, and the values behind the message", () => {
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
    const decision = spec.decisions![0]!;
    expect(Object.keys(decision).sort()).toEqual(["audiences", "data", "kind", "message"]);
    expect(typeof decision.kind).toBe("string");
    expect(Array.isArray(decision.audiences)).toBe(true);
    expect(typeof decision.message).toBe("string");
    // The audiences are the closed set, whatever the kind.
    const known: DecisionAudience[] = ["viewer", "author", "agent"];
    for (const d of spec.decisions!) for (const a of d.audiences) expect(known).toContain(a);
  });

  it("notes is exactly the messages of decisions, in order", () => {
    const spec = resolve(
      {
        rows: [
          { region: "EU", rate: 0.2 },
          { region: "EU", rate: 0.3 },
        ],
        fields: [
          { name: "region", role: "dimension", kind: "string" },
          { name: "rate", role: "measure", kind: "number", format: "percent" },
        ],
        notes: ["Result truncated at 5000 rows."],
      },
      { chartType: "bar" },
    );
    expect(spec.notes).toEqual(spec.decisions!.map((d) => d.message));
    expect(spec.decisions!.map((d) => d.kind)).toEqual(["consumer_note", "dedupe_sum", "rate_sum_hazard"]);
  });
});

describe("resolve() — decision emission", () => {
  it("bar_cap: viewer + agent, with the kept and total counts", () => {
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
    const cap = find(spec, "bar_cap")!;
    expect(cap.audiences).toEqual(["viewer", "agent"]);
    expect(cap.data).toEqual({ kept: 30, total: 50 });
    expect(cap.message).toBe("Showing the top 30 of 50 categories by value.");
  });

  it("encode_unknown_column: author only, naming the dropped columns and what was available", () => {
    const spec = resolve(
      {
        rows: [{ region: "EU", revenue: 10 }],
        fields: [
          { name: "region", role: "dimension", kind: "string" },
          { name: "revenue", role: "measure", kind: "number" },
        ],
        encode: { x: "regoin" },
      },
      { chartType: "bar" },
    );
    const unknown = find(spec, "encode_unknown_column")!;
    expect(unknown.audiences).toEqual(["author"]);
    expect(unknown.data).toEqual({ columns: ["regoin"], available: ["region", "revenue"] });
  });

  it("dedupe_sum: agent only, carrying the collapsed row count", () => {
    const spec = resolve(
      {
        rows: [
          { status: "shipped", amount: 300 },
          { status: "shipped", amount: 50 },
          { status: "open", amount: 50 },
        ],
        fields: [
          { name: "status", role: "dimension", kind: "string" },
          { name: "amount", role: "measure", kind: "number" },
        ],
      },
      { chartType: "bar" },
    );
    const dedupe = find(spec, "dedupe_sum")!;
    expect(dedupe.audiences).toEqual(["agent"]);
    expect(dedupe.data).toEqual({ collapsed: 1, x: "status" });
  });

  it("dedupe_sum on the pivot path threads pivotData's collapsed count and the series dimension", () => {
    const spec = resolve(
      {
        rows: [
          { month: "2026-01-01", region: "EU", revenue: 100 },
          { month: "2026-01-01", region: "EU", revenue: 50 },
          { month: "2026-01-01", region: "US", revenue: 200 },
        ],
        fields: [
          { name: "month", role: "time", kind: "time", granularity: "month" },
          { name: "region", role: "dimension", kind: "string" },
          { name: "revenue", role: "measure", kind: "number" },
        ],
      },
      { chartType: "line" },
    );
    const dedupe = find(spec, "dedupe_sum")!;
    expect(dedupe.data).toEqual({ collapsed: 1, x: "month", seriesDimension: "region" });
    expect(dedupe.message).toMatch(/Summed 1 row\(s\) that shared the same month \+ region/);
  });

  it("no_measure reaches both the author and the agent", () => {
    const spec = resolve({ rows: [{ a: "x", b: "y" }] }, { chartType: "bar" });
    expect(find(spec, "no_measure")!.audiences).toEqual(["author", "agent"]);
  });

  it("scatter_sample survives the scatter branch, which builds its own spec", () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ x: i, y: i * 2 }));
    const spec = resolve(
      {
        rows,
        fields: [
          { name: "x", role: "measure", kind: "number" },
          { name: "y", role: "measure", kind: "number" },
        ],
      },
      { chartType: "scatter" },
    );
    const sample = find(spec, "scatter_sample")!;
    expect(sample.audiences).toEqual(["viewer", "agent"]);
    expect(sample.data).toEqual({ kept: spec.data.length, total: 2500 });
  });

  it("strict throws before recording anything", () => {
    const data: ChartData = {
      rows: [{ region: "EU", revenue: 10 }],
      fields: [
        { name: "region", role: "dimension", kind: "string" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
      encode: { x: "regoin" },
    };
    expect(() => resolve(data, { chartType: "bar", strict: true })).toThrow(/Ignored unknown encode column/);
  });
});

describe("consumer advisories", () => {
  it("normalizes a consumer's flat notes into consumer_note decisions, ahead of resolve's own", () => {
    const spec = resolve(
      {
        rows: [
          { region: "EU", revenue: 10 },
          { region: "EU", revenue: 20 },
        ],
        fields: [
          { name: "region", role: "dimension", kind: "string" },
          { name: "revenue", role: "measure", kind: "number" },
        ],
        notes: ["Result truncated at 5000 rows.", "Figures are illustrative."],
      },
      { chartType: "bar" },
    );
    const consumer = spec.decisions!.filter((d) => d.kind === "consumer_note");
    expect(consumer.map((d) => d.message)).toEqual(["Result truncated at 5000 rows.", "Figures are illustrative."]);
    expect(consumer.every((d) => d.audiences.join() === "viewer,agent")).toBe(true);
    expect(spec.notes![0]).toBe("Result truncated at 5000 rows.");
  });

  it("passes a consumer's own structured decisions through untouched", () => {
    const truncated: Decision = {
      kind: "result_truncated",
      audiences: ["agent"],
      message: "Result truncated at the row cap.",
      data: { returned: 5000, cap: 5000 },
    };
    const spec = resolve(
      {
        rows: [{ region: "EU", revenue: 10 }],
        fields: [
          { name: "region", role: "dimension", kind: "string" },
          { name: "revenue", role: "measure", kind: "number" },
        ],
        decisions: [truncated],
      },
      { chartType: "bar" },
    );
    expect(find(spec, "result_truncated")).toEqual(truncated);
    expect(spec.notes).toEqual(["Result truncated at the row cap."]);
  });

  it("chart() merges the coerced-column advisory as an author decision", () => {
    const spec = chart([{ region: "EU", revenue: "1200" }], { chartType: "bar" });
    const coerced = find(spec, "coerced_numeric_strings")!;
    expect(coerced.audiences).toEqual(["author"]);
    expect(coerced.data).toEqual({ column: "revenue" });
    expect(spec.notes).toEqual(spec.decisions!.map((d) => d.message));
  });

  it("explain() returns the decisions alongside the notes", () => {
    const ex = explain([{ region: "EU", revenue: "1200" }], { chartType: "bar" });
    expect(ex.decisions.map((d) => d.kind)).toContain("coerced_numeric_strings");
    expect(ex.notes).toEqual(ex.decisions.map((d) => d.message));
  });
});
