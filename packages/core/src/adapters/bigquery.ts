// BigQuery -> ChartData adapter. The ONLY engine-specific pieces are here: the type map and the
// cell normalizer (BigQuery returns typed strings — "7.19E-4", "1389" — or, via the Node client,
// wrapper objects like BigQueryDate/Int + Big). The FieldMeta assembly, name hints, ChartData
// shape and read-only backstop come from ./sql (shared by every adapter).
//
// Usage (the dev owns the client + safety):
//   const [job] = await bq.createQueryJob({ query, location, maximumBytesBilled, jobTimeoutMs });
//   const [rows, , apiResponse] = await job.getQueryResults();
//   const data = bigQueryToChartData(rows, apiResponse.schema.fields);  // -> ChartData
import type { TableField } from "@google-cloud/bigquery";
import type { ChartData, FieldKind } from "../types.js";
import { buildChartData, type SourceColumn } from "./sql.js";

/** A BigQuery schema field. Anchored to the client's own `TableField` type so it tracks the driver:
 *  if @google-cloud/bigquery changes the schema shape, this and its consumers fail to compile.
 *  Relevant fields: `type` (INT64/FLOAT64/NUMERIC/BOOL/STRING/DATE/DATETIME/TIMESTAMP/TIME/RECORD/…),
 *  `mode` (NULLABLE | REQUIRED | REPEATED, where REPEATED is a non-scalar ARRAY). */
export type BigQueryField = TableField;

// BigQuery reports both GoogleSQL and legacy names depending on the API surface — handle both.
const NUMERIC = new Set(["INT64", "INTEGER", "FLOAT64", "FLOAT", "NUMERIC", "BIGNUMERIC"]);
const TEMPORAL = new Set(["DATE", "DATETIME", "TIMESTAMP"]);
const BOOLEAN = new Set(["BOOL", "BOOLEAN"]);

function bqKind(field: BigQueryField): FieldKind {
  if (field.mode === "REPEATED") return "string"; // ARRAY -> not scalar-plottable, stringify
  const t = (field.type || "").toUpperCase();
  if (t === "RECORD" || t === "STRUCT") return "string"; // nested -> stringify
  if (NUMERIC.has(t)) return "number";
  if (TEMPORAL.has(t)) return "time";
  if (BOOLEAN.has(t)) return "boolean";
  return "string"; // STRING, TIME, BYTES, GEOGRAPHY, JSON, ...
}

// Coerce one BigQuery cell to a flat scalar, handling raw-string (REST) and wrapper-object (Node
// client) representations, guided by the column's declared kind.
function bqNormalize(value: unknown, kind: FieldKind): unknown {
  if (value == null) return null;
  const obj = typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (kind === "number") {
    const raw = obj ? ("value" in obj ? obj.value : (value as { toString(): string }).toString()) : value;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === "time") {
    // BigQueryDate/Datetime/Timestamp -> { value } (ISO string); raw -> ISO string already.
    if (obj && "value" in obj) return obj.value;
    return typeof value === "string" ? value : String(value);
  }
  if (kind === "boolean") {
    if (typeof value === "boolean") return value;
    const s = String(value).toLowerCase();
    return s === "true" || s === "1" ? true : s === "false" || s === "0" ? false : null;
  }
  // string-ish: stringify arrays/structs so the scalar guard passes; unwrap { value }; else String.
  if (obj) {
    if (Array.isArray(value)) return JSON.stringify(value);
    if ("value" in obj) return String(obj.value);
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Convert a BigQuery query result into ChartData.
 * @param rows   Result rows (record objects), as returned by `@google-cloud/bigquery` or the REST API.
 * @param schema The result's `schema.fields` (BigQuery's standard TableFieldSchema list).
 */
export function bigQueryToChartData(rows: Record<string, unknown>[], schema: BigQueryField[]): ChartData {
  const columns: SourceColumn[] = schema.map((f) => ({ name: f.name ?? "", type: f }));
  return buildChartData({
    rows,
    columns,
    mapKind: (type) => bqKind(type as BigQueryField),
    normalizeCell: bqNormalize,
  });
}
