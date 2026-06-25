// @bonnard/mcp-charts/snowflake — drop-in Snowflake adapter for addCharts.
//
// The caller owns the connection + auth; this packages the dev-side `runSql`: a read-only check
// plus the result -> ChartData transform. Use a read-only role / warehouse as the real boundary.
//
//   import { addCharts } from "@bonnard/mcp-charts";
//   import { snowflakeRunSql } from "@bonnard/mcp-charts/snowflake";
//   import snowflake from "snowflake-sdk";
//
//   const connection = snowflake.createConnection({ account, username, ... });
//   await new Promise((res, rej) => connection.connect((e) => (e ? rej(e) : res(null))));
//   addCharts(server, { runSql: snowflakeRunSql(connection), discovery: { toolName: "explore_schema" } });
//
// `snowflake-sdk` is an OPTIONAL peer — only needed if you import this subpath.
import type { Connection } from "snowflake-sdk";
import type { ChartData } from "./types.js";
import { assertReadOnlySql } from "./adapters/sql.js";
import { snowflakeToChartData } from "./adapters/snowflake.js";

export { snowflakeToChartData, type SnowflakeColumn } from "./adapters/snowflake.js";

export interface SnowflakeRunSqlOptions {
  /** Reject non-SELECT statements. Default: true. A read-only role is the real boundary. */
  readOnly?: boolean;
}

/** Build the `runSql` callback for `addCharts` from a connected snowflake-sdk Connection. */
export function snowflakeRunSql(connection: Connection, opts: SnowflakeRunSqlOptions = {}): (sql: string) => Promise<ChartData> {
  const readOnly = opts.readOnly !== false;
  return (sql: string): Promise<ChartData> =>
    new Promise<ChartData>((resolve, reject) => {
      if (readOnly) {
        try {
          assertReadOnlySql(sql);
        } catch (err) {
          reject(err);
          return;
        }
      }
      connection.execute({
        sqlText: sql,
        complete: (err, stmt, rows) => {
          if (err) {
            reject(err);
            return;
          }
          const columns = (stmt.getColumns() ?? []).map((c) => ({ name: c.getName(), type: c.getType() }));
          resolve(snowflakeToChartData((rows ?? []) as Record<string, unknown>[], columns));
        },
      });
    });
}
