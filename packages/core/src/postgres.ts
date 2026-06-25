// @bonnard/mcp-charts/postgres — drop-in Postgres adapter for addCharts. Works with any
// Postgres-wire endpoint, including a Cube SQL API or a Redshift cluster.
//
// The caller owns the pool + credentials; this packages the dev-side `runSql`: each query runs
// inside a `READ ONLY` transaction so Postgres itself rejects writes, plus the result -> ChartData
// transform. A read-only database role is still the real boundary.
//
//   import { addCharts } from "@bonnard/mcp-charts";
//   import { postgresRunSql } from "@bonnard/mcp-charts/postgres";
//   import { Pool } from "pg";
//
//   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
//   addCharts(server, { runSql: postgresRunSql(pool), discovery: { toolName: "explore_schema" } });
//
// `pg` is an OPTIONAL peer — only needed if you import this subpath. The type import below is erased
// at build, and the OID map is self-contained, so this module adds no runtime dependency.
import type { Pool } from "pg";
import type { ChartData } from "./types.js";
import { assertReadOnlySql } from "./adapters/sql.js";
import { postgresToChartData } from "./adapters/postgres.js";

export { postgresToChartData, type PostgresField } from "./adapters/postgres.js";

export interface PostgresRunSqlOptions {
  /** Reject non-SELECT statements + run inside a READ ONLY transaction. Default: true. */
  readOnly?: boolean;
}

/** Build the `runSql` callback for `addCharts` from a pg Pool. */
export function postgresRunSql(pool: Pool, opts: PostgresRunSqlOptions = {}): (sql: string) => Promise<ChartData> {
  const readOnly = opts.readOnly !== false;
  return async (sql: string): Promise<ChartData> => {
    if (readOnly) assertReadOnlySql(sql);
    // A dedicated connection so BEGIN/ROLLBACK bracket the same session (a Pool may round-robin).
    const client = await pool.connect();
    try {
      if (readOnly) await client.query("BEGIN TRANSACTION READ ONLY");
      const res = await client.query(sql);
      if (readOnly) await client.query("ROLLBACK");
      return postgresToChartData(res.rows, res.fields);
    } catch (err) {
      if (readOnly) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };
}
