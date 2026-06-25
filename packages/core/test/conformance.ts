// Shared adapter conformance assertions. Any adapter's ChartData output (or its runSql) can be
// run through these to prove it satisfies the contract: typed fields, scalar cells, flat-object
// rows, and a read-only backstop that rejects writes.
import { expect } from "vitest";
import type { ChartData, FieldKind } from "../src/index.js";

const SCALAR = new Set(["string", "number", "boolean", "bigint"]);
const isScalar = (v: unknown): boolean => v == null || SCALAR.has(typeof v) || v instanceof Date;

/** The ChartData contract every adapter must produce. */
export function assertChartDataShape(data: ChartData): void {
  expect(Array.isArray(data.rows), "rows must be an array").toBe(true);
  expect(Array.isArray(data.fields), "an adapter should supply typed fields").toBe(true);
  for (const f of data.fields!) {
    expect(typeof f.name).toBe("string");
    expect(f.kind, `field "${f.name}" needs a kind`).toBeDefined();
    expect(f.role, `field "${f.name}" needs a role`).toBeDefined();
  }
  const names = data.fields!.map((f) => f.name);
  for (const row of data.rows.slice(0, 50)) {
    expect(typeof row === "object" && !Array.isArray(row), "each row must be a flat object").toBe(true);
    for (const name of names) {
      expect(isScalar((row as Record<string, unknown>)[name]), `column "${name}" must be scalar`).toBe(true);
    }
  }
}

/** Assert declared kinds for named columns (the per-engine type map is correct). */
export function assertKinds(data: ChartData, expected: Record<string, FieldKind>): void {
  const by = new Map(data.fields!.map((f) => [f.name, f.kind]));
  for (const [name, kind] of Object.entries(expected)) {
    expect(by.get(name), `expected ${name} -> ${kind}`).toBe(kind);
  }
}

/** Assert the adapter's read-only backstop rejects write / DDL statements. */
export async function assertRejectsWrites(runSql: (sql: string) => Promise<unknown>): Promise<void> {
  const writes = ["DELETE FROM t", "INSERT INTO t VALUES (1)", "UPDATE t SET x=1", "DROP TABLE t", "CREATE TABLE t(x INT)"];
  for (const sql of writes) await expect(runSql(sql), `should reject: ${sql}`).rejects.toThrow();
}
