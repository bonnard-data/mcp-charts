// DuckDB adapter — runs in-process (no server), so this exercises the real driver end to end:
// real column types from reader.columnTypes() and real JSON-safe values from getRowObjectsJson().
import { describe, it, expect, beforeAll } from "vitest";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { duckDbRunSql } from "../src/duckdb.js";
import { resolve } from "../src/resolve/resolve.js";
import { assertChartDataShape, assertKinds, assertRejectsWrites } from "./conformance.js";

let connection: DuckDBConnection;
let runSql: (sql: string) => Promise<import("../src/index.js").ChartData>;

beforeAll(async () => {
  const instance = await DuckDBInstance.create(":memory:");
  connection = await instance.connect();
  await connection.run(`CREATE TABLE orders AS SELECT * FROM (VALUES
    ('EU',   DATE '2026-01-01', 100, CAST(0.42 AS DOUBLE), true),
    ('US',   DATE '2026-02-01', 250, CAST(0.55 AS DOUBLE), false),
    ('APAC', DATE '2026-03-01', 175, CAST(0.31 AS DOUBLE), true)
  ) AS t(region, month, revenue, win_rate, active)`);
  runSql = duckDbRunSql(connection);
});

describe("duckDbRunSql — typing from real DuckDB column types", () => {
  it("maps DuckDB types to FieldKind and returns scalar rows", async () => {
    const data = await runSql("SELECT region, month, revenue, win_rate, active FROM orders ORDER BY month");
    assertChartDataShape(data);
    assertKinds(data, { region: "string", month: "time", revenue: "number", win_rate: "number", active: "boolean" });
    // name heuristic: *_rate -> percent
    expect(data.fields!.find((f) => f.name === "win_rate")?.format).toBe("percent");
    // values come back as JSON-safe scalars
    expect(data.rows[0]).toMatchObject({ region: "EU", revenue: 100, active: true });
    expect(typeof data.rows[0]!.month).toBe("string"); // DATE -> ISO-ish string, typed time
  });

  it("BIGINT and DECIMAL coerce to JS numbers", async () => {
    const data = await runSql("SELECT CAST(9007199254740990 AS BIGINT) AS big, CAST(12.50 AS DECIMAL(10,2)) AS amount");
    assertKinds(data, { big: "number", amount: "number" });
    expect(typeof data.rows[0]!.big).toBe("number");
    expect(data.rows[0]!.amount).toBe(12.5);
  });

  it("non-scalar columns (LIST/STRUCT) are stringified so charts stay scalar", async () => {
    const data = await runSql("SELECT [1,2,3] AS tags, {'a': 1} AS meta");
    assertChartDataShape(data); // would throw if a cell were an array/object
    expect(typeof data.rows[0]!.tags).toBe("string");
    expect(typeof data.rows[0]!.meta).toBe("string");
  });

  it("feeds resolve() end to end", async () => {
    const data = await runSql("SELECT region, revenue FROM orders ORDER BY revenue DESC");
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.chartType).toBe("bar");
    expect(spec.x).toBe("region");
    expect(spec.series.map((s) => s.key)).toContain("revenue");
  });

  it("read-only backstop rejects writes", async () => {
    await assertRejectsWrites(runSql);
  });
});
