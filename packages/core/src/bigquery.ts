// @bonnard/mcp-charts/bigquery — drop-in BigQuery adapter for addCharts.
//
// The caller owns the client, auth (ADC / service account) and IAM (read-only); this packages the
// rest of the dev-side `runSql`: a read-only guard, a cost cap + timeout, an optional default
// dataset, and the schema-driven result -> ChartData transform.
//
//   import { addCharts } from "@bonnard/mcp-charts";
//   import { bigQueryRunSql } from "@bonnard/mcp-charts/bigquery";
//   import { BigQuery } from "@google-cloud/bigquery";
//
//   const bq = new BigQuery(); // ADC: local = gcloud login; prod = Workload Identity service account
//   addCharts(server, {
//     runSql: bigQueryRunSql(bq, {
//       location: "europe-west2",
//       maximumBytesBilled: "200000000",      // cost guard
//       defaultDataset: "analytics_internal", // unqualified table names resolve here
//     }),
//     discovery: { toolName: "explore_schema" },
//   });
//
// `@google-cloud/bigquery` is an OPTIONAL peer (only needed if you import this subpath). The type
// import below is erased at build, so this module adds no runtime dependency — it just calls methods
// on the client you pass in.
import type { BigQuery } from "@google-cloud/bigquery";
import type { ChartData } from "./types.js";
import { assertReadOnlySql } from "./adapters/sql.js";
import { bigQueryToChartData, type BigQueryField } from "./adapters/bigquery.js";

export { bigQueryToChartData, type BigQueryField };

export interface BigQueryRunSqlOptions {
  /** BigQuery processing location (must match the dataset region), e.g. "europe-west2". */
  location?: string;
  /** Cost guard: max bytes a single query may bill (BigQuery's string API shape). */
  maximumBytesBilled?: string;
  /** Per-query timeout in milliseconds. */
  jobTimeoutMs?: number;
  /** Default dataset so the agent can write unqualified table names (e.g. `weekly_sales`). */
  defaultDataset?: string | { datasetId: string; projectId?: string };
  /** Reject non-SELECT (DML/DDL) statements. Default: true. A read-only IAM role is the real boundary. */
  readOnly?: boolean;
}

/**
 * Build the `runSql` callback for `addCharts` from a BigQuery client.
 * Runs the query with the configured guards and returns schema-typed ChartData.
 */
export function bigQueryRunSql(bq: BigQuery, opts: BigQueryRunSqlOptions = {}): (sql: string) => Promise<ChartData> {
  const defaultDataset =
    typeof opts.defaultDataset === "string" ? { datasetId: opts.defaultDataset } : opts.defaultDataset;
  return async (sql: string): Promise<ChartData> => {
    if (opts.readOnly !== false) assertReadOnlySql(sql);
    const [job] = await bq.createQueryJob({
      query: sql,
      ...(opts.location && { location: opts.location }),
      ...(opts.maximumBytesBilled && { maximumBytesBilled: opts.maximumBytesBilled }),
      ...(opts.jobTimeoutMs && { jobTimeoutMs: opts.jobTimeoutMs }),
      ...(defaultDataset && { defaultDataset }),
    });
    const [rows, , apiResponse] = await job.getQueryResults();
    const schema: BigQueryField[] = apiResponse?.schema?.fields ?? [];
    return bigQueryToChartData(rows as Record<string, unknown>[], schema);
  };
}
