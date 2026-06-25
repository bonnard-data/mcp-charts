// @bonnard/mcp-charts/databricks — drop-in Databricks SQL adapter for addCharts.
//
// The caller owns the client/session + auth; this packages the dev-side `runSql`: a read-only check
// plus the result -> ChartData transform. Use a read-only SQL warehouse / Unity Catalog grants as
// the real boundary.
//
//   import { addCharts } from "@bonnard/mcp-charts";
//   import { databricksRunSql } from "@bonnard/mcp-charts/databricks";
//   import { DBSQLClient } from "@databricks/sql";
//
//   const client = new DBSQLClient();
//   await client.connect({ host, path, token });
//   const session = await client.openSession();
//   addCharts(server, { runSql: databricksRunSql(session), discovery: { toolName: "explore_schema" } });
//
// `@databricks/sql` is an OPTIONAL peer — only needed if you import this subpath.
import type { DBSQLSession } from "@databricks/sql";
import type { ChartData } from "./types.js";
import { assertReadOnlySql } from "./adapters/sql.js";
import { databricksToChartData } from "./adapters/databricks.js";

export { databricksToChartData, type DatabricksColumn } from "./adapters/databricks.js";

export interface DatabricksRunSqlOptions {
  /** Reject non-SELECT statements. Default: true. A read-only warehouse/grant is the real boundary. */
  readOnly?: boolean;
}

/** Build the `runSql` callback for `addCharts` from an open Databricks SQL session. */
export function databricksRunSql(session: DBSQLSession, opts: DatabricksRunSqlOptions = {}): (sql: string) => Promise<ChartData> {
  const readOnly = opts.readOnly !== false;
  return async (sql: string): Promise<ChartData> => {
    if (readOnly) assertReadOnlySql(sql);
    const operation = await session.executeStatement(sql);
    try {
      const [rows, schema] = await Promise.all([operation.fetchAll(), operation.getSchema()]);
      const columns = (schema?.columns ?? []).map((c) => ({
        name: c.columnName,
        typeId: c.typeDesc?.types?.[0]?.primitiveEntry?.type ?? -1,
      }));
      return databricksToChartData(rows as Record<string, unknown>[], columns);
    } finally {
      await operation.close();
    }
  };
}
