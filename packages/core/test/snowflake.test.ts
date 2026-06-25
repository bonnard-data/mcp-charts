// Snowflake adapter — no in-process engine, so this drives the full runner through a type-anchored
// stub Connection (recorded result shape) to exercise column extraction + the type map + transform.
import { describe, it, expect } from "vitest";
import type { Connection } from "snowflake-sdk";
import { snowflakeRunSql, snowflakeToChartData, type SnowflakeColumn } from "../src/snowflake.js";
import { resolve } from "../src/resolve/resolve.js";
import { assertChartDataShape, assertKinds, assertRejectsWrites } from "./conformance.js";

// Recorded shape: snowflake-sdk logical types (Column.getType()) + the JS values it returns.
const COLUMNS: SnowflakeColumn[] = [
  { name: "REGION", type: "text" },
  { name: "MONTH", type: "date" },
  { name: "REVENUE", type: "fixed" },
  { name: "WIN_RATE", type: "real" },
  { name: "ACTIVE", type: "boolean" },
  { name: "META", type: "variant" },
];
const ROWS: Record<string, unknown>[] = [
  { REGION: "EU", MONTH: new Date(Date.UTC(2026, 0, 1)), REVENUE: 100, WIN_RATE: 0.42, ACTIVE: true, META: { a: 1 } },
  { REGION: "US", MONTH: new Date(Date.UTC(2026, 1, 1)), REVENUE: 250, WIN_RATE: 0.55, ACTIVE: false, META: { a: 2 } },
];

function stubConnection(rows = ROWS, columns = COLUMNS): Connection {
  return {
    execute({ complete }: { complete: (e: unknown, s: unknown, r: unknown[]) => void }) {
      const stmt = { getColumns: () => columns.map((c) => ({ getName: () => c.name, getType: () => c.type })) };
      complete(undefined, stmt, rows);
    },
  } as unknown as Connection;
}

describe("snowflake adapter", () => {
  it("maps logical types -> FieldKind and normalizes to scalars", async () => {
    const data = await snowflakeRunSql(stubConnection())("SELECT * FROM orders");
    assertChartDataShape(data);
    assertKinds(data, {
      REGION: "string",
      MONTH: "time",
      REVENUE: "number",
      WIN_RATE: "number",
      ACTIVE: "boolean",
      META: "string",
    });
    expect(data.fields!.find((f) => f.name === "WIN_RATE")?.format).toBe("percent");
    expect(data.rows[0]).toMatchObject({ REGION: "EU", MONTH: "2026-01-01", REVENUE: 100, ACTIVE: true });
    expect(typeof data.rows[0]!.META).toBe("string"); // variant stringified
  });

  it("transform is usable directly + feeds resolve", () => {
    const spec = resolve(snowflakeToChartData(ROWS, COLUMNS), { chartType: "line" });
    expect(spec.x).toBe("MONTH");
    expect(spec.series.map((s) => s.key)).toContain("REVENUE");
  });

  it("read-only backstop rejects writes", async () => {
    await assertRejectsWrites(snowflakeRunSql(stubConnection()));
  });
});
