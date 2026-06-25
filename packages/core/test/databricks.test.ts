// Databricks adapter — no in-process engine, so this drives the full runner through a type-anchored
// stub session (recorded Thrift schema shape) to exercise TTypeId extraction + the type map.
import { describe, it, expect } from "vitest";
import type { DBSQLSession } from "@databricks/sql";
import { databricksRunSql, databricksToChartData, type DatabricksColumn } from "../src/databricks.js";
import { resolve } from "../src/resolve/resolve.js";
import { assertChartDataShape, assertKinds, assertRejectsWrites } from "./conformance.js";

// Recorded shape: Thrift TTypeId codes + the JS values @databricks/sql returns (date/timestamp as
// ISO strings, ints/doubles as numbers).
const COLUMNS: DatabricksColumn[] = [
  { name: "region", typeId: 7 }, // STRING
  { name: "month", typeId: 17 }, // DATE
  { name: "revenue", typeId: 4 }, // BIGINT
  { name: "win_rate", typeId: 6 }, // DOUBLE
  { name: "active", typeId: 0 }, // BOOLEAN
];
const ROWS: Record<string, unknown>[] = [
  { region: "EU", month: "2026-01-01", revenue: 100, win_rate: 0.42, active: true },
  { region: "US", month: "2026-02-01", revenue: 250, win_rate: 0.55, active: false },
];

function stubSession(rows = ROWS, columns = COLUMNS): DBSQLSession {
  return {
    executeStatement: async () => ({
      fetchAll: async () => rows,
      getSchema: async () => ({
        columns: columns.map((c, i) => ({
          columnName: c.name,
          position: i,
          typeDesc: { types: [{ primitiveEntry: { type: c.typeId } }] },
        })),
      }),
      close: async () => ({}),
    }),
  } as unknown as DBSQLSession;
}

describe("databricks adapter", () => {
  it("maps TTypeId -> FieldKind and normalizes to scalars", async () => {
    const data = await databricksRunSql(stubSession())("SELECT * FROM orders");
    assertChartDataShape(data);
    assertKinds(data, { region: "string", month: "time", revenue: "number", win_rate: "number", active: "boolean" });
    expect(data.fields!.find((f) => f.name === "win_rate")?.format).toBe("percent");
    expect(data.rows[0]).toMatchObject({ region: "EU", month: "2026-01-01", revenue: 100, active: true });
  });

  it("transform is usable directly + feeds resolve", () => {
    const spec = resolve(databricksToChartData(ROWS, COLUMNS), { chartType: "bar" });
    expect(spec.x).toBe("month");
    expect(spec.series.map((s) => s.key)).toContain("revenue");
  });

  it("read-only backstop rejects writes", async () => {
    await assertRejectsWrites(databricksRunSql(stubSession()));
  });
});
