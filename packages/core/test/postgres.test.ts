// Postgres adapter — runs in-process via PGlite (real Postgres compiled to WASM, no server), so
// this exercises real OIDs from result.fields and real value representations (int8/numeric as
// strings, date as Date) through the transform.
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { postgresToChartData } from "../src/postgres.js";
import { resolve } from "../src/resolve/resolve.js";
import { assertChartDataShape, assertKinds } from "./conformance.js";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE orders (
      region text, month date, revenue integer,
      win_rate double precision, big bigint, amount numeric(10,2), active boolean
    );
    INSERT INTO orders VALUES
      ('EU',   '2026-01-01', 100, 0.42, 9007199254740990, 12.50, true),
      ('US',   '2026-02-01', 250, 0.55, 1, 7.25, false),
      ('APAC', '2026-03-01', 175, 0.31, 42, 9.00, true);
  `);
});

const run = async (sql: string) => {
  const res = await db.query<Record<string, unknown>>(sql);
  return postgresToChartData(res.rows, res.fields);
};

describe("postgresToChartData — typing from real Postgres OIDs", () => {
  it("maps OIDs to FieldKind and normalizes to scalars", async () => {
    const data = await run("SELECT region, month, revenue, win_rate, big, amount, active FROM orders ORDER BY month");
    assertChartDataShape(data);
    assertKinds(data, {
      region: "string",
      month: "time",
      revenue: "number",
      win_rate: "number",
      big: "number",
      amount: "number",
      active: "boolean",
    });
    expect(data.fields!.find((f) => f.name === "win_rate")?.format).toBe("percent"); // *_rate heuristic
    expect(data.rows[0]).toMatchObject({ region: "EU", month: "2026-01-01", revenue: 100, amount: 12.5, active: true });
    expect(typeof data.rows[0]!.big).toBe("number"); // int8 returned as string -> coerced
  });

  it("DATE keeps the calendar day (no UTC shift)", async () => {
    const data = await run("SELECT DATE '2026-03-01' AS d");
    expect(data.rows[0]!.d).toBe("2026-03-01");
  });

  it("date_trunc('month') infers month granularity from the values, not 'day'", async () => {
    const data = await run(
      "SELECT date_trunc('month', month)::date AS bucket, SUM(revenue) AS revenue FROM orders GROUP BY 1 ORDER BY 1",
    );
    expect(data.fields!.find((f) => f.name === "bucket")?.granularity).toBe("month");
  });

  it("non-scalar columns (array/json) stringify so charts stay scalar", async () => {
    const data = await run("SELECT ARRAY[1,2,3] AS tags, '{\"a\":1}'::json AS meta");
    assertChartDataShape(data);
    expect(typeof data.rows[0]!.tags).toBe("string");
    expect(typeof data.rows[0]!.meta).toBe("string");
  });

  it("engine-enforced READ ONLY transaction blocks writes", async () => {
    await db.query("BEGIN TRANSACTION READ ONLY");
    await expect(db.query("INSERT INTO orders(region) VALUES ('X')")).rejects.toThrow();
    await db.query("ROLLBACK");
  });

  it("feeds resolve() end to end", async () => {
    const data = await run("SELECT region, revenue FROM orders ORDER BY revenue DESC");
    const spec = resolve(data, { chartType: "bar" });
    expect(spec.chartType).toBe("bar");
    expect(spec.x).toBe("region");
    expect(spec.series.map((s) => s.key)).toContain("revenue");
  });
});
