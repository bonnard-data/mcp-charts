// BigQuery adapter — schema-driven typing + value normalization for query results.
import { describe, it, expect } from "vitest";
import { bigQueryToChartData, type BigQueryField } from "../src/adapters/bigquery.js";
import { bigQueryRunSql } from "../src/bigquery.js";
import { resolve } from "../src/resolve/resolve.js";

// A weekly sales mart, with legacy type names as `bq show --schema` returns them.
const SCHEMA: BigQueryField[] = [
  { name: "region", type: "STRING" },
  { name: "customer", type: "STRING" },
  { name: "week_start", type: "DATE" },
  { name: "orders_placed", type: "INTEGER" },
  { name: "orders_shipped", type: "INTEGER" },
  { name: "completion_rate", type: "FLOAT" },
];

describe("bigQueryToChartData — typing from schema", () => {
  it("maps BigQuery types to FieldMeta (kind/role/format/granularity)", () => {
    const { fields } = bigQueryToChartData([], SCHEMA);
    const by = Object.fromEntries(fields!.map((f) => [f.name, f]));
    expect(by.region).toMatchObject({ kind: "string", role: "dimension", label: "Region" });
    expect(by.week_start).toMatchObject({ kind: "time", role: "time", granularity: "week" });
    expect(by.orders_placed).toMatchObject({ kind: "number", role: "measure" });
    // name heuristic: *_rate -> percent format
    expect(by.completion_rate).toMatchObject({ kind: "number", format: "percent" });
  });

  it("infers percent from broadened name variants (snake, camelCase, percentage, ratio)", () => {
    const { fields } = bigQueryToChartData([], [
      { name: "approval_rate", type: "FLOAT64" },
      { name: "approvalRate", type: "FLOAT64" }, // camelCase
      { name: "conversion_percentage", type: "FLOAT64" }, // "percentage", not just "percent"
      { name: "win_ratio", type: "FLOAT64" },
      { name: "ctr_pct", type: "FLOAT64" },
      { name: "revenue", type: "INT64" }, // not a percent
    ]);
    const by = Object.fromEntries(fields!.map((f) => [f.name, f]));
    expect(by.approval_rate.format).toBe("percent");
    expect(by.approvalRate.format).toBe("percent");
    expect(by.conversion_percentage.format).toBe("percent");
    expect(by.win_ratio.format).toBe("percent");
    expect(by.ctr_pct.format).toBe("percent");
    expect(by.revenue.format).toBeUndefined();
  });

  it("accepts GoogleSQL names too (INT64/FLOAT64), not just legacy (INTEGER/FLOAT)", () => {
    const { fields } = bigQueryToChartData([], [
      { name: "n", type: "INT64" },
      { name: "x", type: "FLOAT64" },
    ]);
    expect(fields!.every((f) => f.kind === "number")).toBe(true);
  });
});

describe("bigQueryToChartData — value normalization", () => {
  it("coerces raw REST strings (incl. scientific-notation floats) to scalars by schema type", () => {
    // Exactly the shape `bq query --format=prettyjson` returns: everything a string.
    const rows = [
      { region: "EU", customer: "Acme Corp", week_start: "2026-06-15",
        orders_placed: "1389", orders_shipped: "1372", completion_rate: "7.199424046076314E-4" },
    ];
    const { rows: out } = bigQueryToChartData(rows, SCHEMA);
    expect(out[0]!.orders_placed).toBe(1389); // number, not "1389"
    expect(out[0]!.completion_rate).toBeCloseTo(0.00072, 6); // sci-notation string -> number
    expect(out[0]!.week_start).toBe("2026-06-15"); // ISO string preserved
    expect(out[0]!.customer).toBe("Acme Corp");
  });

  it("unwraps @google-cloud/bigquery typed wrappers (BigQueryDate/Int, Big)", () => {
    const rows = [
      {
        region: "US",
        customer: "Globex",
        week_start: { value: "2026-06-15" }, // BigQueryDate
        orders_placed: { value: "35" }, // BigQueryInt
        orders_shipped: 34, // plain number (FLOAT64/INT64 without wrapIntegers)
        completion_rate: { toString: () => "0.9714285714285714" }, // Big (NUMERIC-like)
      },
    ];
    const { rows: out } = bigQueryToChartData(rows, SCHEMA);
    expect(out[0]!.week_start).toBe("2026-06-15");
    expect(out[0]!.orders_placed).toBe(35);
    expect(out[0]!.orders_shipped).toBe(34);
    expect(out[0]!.completion_rate).toBeCloseTo(0.9714, 4);
  });

  it("passes nulls through and stringifies non-scalar cells (ARRAY/STRUCT/JSON)", () => {
    const schema: BigQueryField[] = [
      { name: "k", type: "STRING" },
      { name: "tags", type: "STRING", mode: "REPEATED" },
      { name: "meta", type: "RECORD", fields: [{ name: "a", type: "INT64" }] },
      { name: "n", type: "INT64" },
    ];
    const { rows: out, fields } = bigQueryToChartData(
      [{ k: "x", tags: ["a", "b"], meta: { a: 1 }, n: null }],
      schema,
    );
    expect(out[0]!.tags).toBe('["a","b"]');
    expect(out[0]!.meta).toBe('{"a":1}');
    expect(out[0]!.n).toBeNull();
    expect(fields!.find((f) => f.name === "tags")?.kind).toBe("string"); // REPEATED -> not a measure
  });
});

describe("bigQueryRunSql — packaged helper", () => {
  // Minimal fake of the @google-cloud/bigquery client surface the helper uses.
  const fakeBq = (rows: Record<string, unknown>[], schema: BigQueryField[], capture: { opts?: any } = {}) =>
    ({
      async createQueryJob(opts: any) {
        capture.opts = opts;
        return [{ async getQueryResults() { return [rows, null, { schema: { fields: schema } }]; } }];
      },
    }) as any;

  it("runs a query, returns schema-typed ChartData, and forwards the guards", async () => {
    const capture: { opts?: any } = {};
    const run = bigQueryRunSql(
      fakeBq(
        [{ week_start: "2026-06-15", n: "5" }],
        [{ name: "week_start", type: "DATE" }, { name: "n", type: "INTEGER" }],
        capture,
      ),
      { location: "europe-west2", maximumBytesBilled: "100", defaultDataset: "ds" },
    );
    const data = await run("SELECT week_start, n FROM t");
    expect(data.fields?.find((f) => f.name === "week_start")?.kind).toBe("time");
    expect(data.rows[0]!.n).toBe(5); // string "5" -> number, schema-driven
    expect(capture.opts.location).toBe("europe-west2");
    expect(capture.opts.maximumBytesBilled).toBe("100");
    expect(capture.opts.defaultDataset).toEqual({ datasetId: "ds" }); // string shorthand expanded
  });

  it("rejects non-read-only SQL by default", async () => {
    const run = bigQueryRunSql(fakeBq([], []));
    await expect(run("DELETE FROM t")).rejects.toThrow(/read-only|not allowed/i);
  });
});

describe("bigQueryToChartData — composes with resolve()", () => {
  it("a weekly mart resolves to a sensible time-series spec", () => {
    // week + measure only (no dimension) -> a clean single-series weekly line.
    const schema: BigQueryField[] = [
      { name: "week_start", type: "DATE" },
      { name: "orders_placed", type: "INTEGER" },
    ];
    const rows = [
      { week_start: "2026-06-01", orders_placed: "10" },
      { week_start: "2026-06-08", orders_placed: "20" },
    ];
    const spec = resolve(bigQueryToChartData(rows, schema), { chartType: "line" });
    expect(spec.chartType).toBe("line");
    expect(spec.x).toBe("week_start");
    expect(spec.xAxis?.granularity).toBe("week"); // from the name heuristic
    expect(spec.series.map((s) => s.key)).toEqual(["orders_placed"]);
    expect(spec.data.every((r) => typeof r.orders_placed === "number")).toBe(true);
  });
});
