// @bonnard/mcp-charts/duckdb — drop-in DuckDB adapter for addCharts.
//
// The caller owns the instance + connection; this packages the dev-side `runSql`: a read-only
// check plus the result -> ChartData transform. For engine-enforced read-only, open a file-backed
// instance with `{ access_mode: "READ_ONLY" }`.
//
//   import { addCharts } from "@bonnard/mcp-charts";
//   import { duckDbRunSql } from "@bonnard/mcp-charts/duckdb";
//   import { DuckDBInstance } from "@duckdb/node-api";
//
//   const instance = await DuckDBInstance.create("analytics.duckdb", { access_mode: "READ_ONLY" });
//   const connection = await instance.connect();
//   addCharts(server, { runSql: duckDbRunSql(connection), discovery: { toolName: "explore_schema" } });
//
// `@duckdb/node-api` is an OPTIONAL peer — only needed if you import this subpath.
import type { DuckDBConnection } from "@duckdb/node-api";
import type { ChartData } from "./types.js";
import { assertReadOnlySql } from "./adapters/sql.js";
import { duckDbToChartData } from "./adapters/duckdb.js";

export { duckDbToChartData, type DuckDbColumn } from "./adapters/duckdb.js";

export interface DuckDbRunSqlOptions {
  /** Reject non-SELECT statements. Default: true. A read-only instance is the real boundary. */
  readOnly?: boolean;
}

/** Build the `runSql` callback for `addCharts` from a DuckDB connection. */
export function duckDbRunSql(
  connection: DuckDBConnection,
  opts: DuckDbRunSqlOptions = {},
): (sql: string) => Promise<ChartData> {
  return async (sql: string): Promise<ChartData> => {
    if (opts.readOnly !== false) assertReadOnlySql(sql);
    const reader = await connection.runAndReadAll(sql);
    const names = reader.columnNames();
    const types = reader.columnTypes();
    const columns = names.map((name, i) => ({ name, type: types[i]! }));
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    return duckDbToChartData(rows, columns);
  };
}
