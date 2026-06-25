// Databricks -> ChartData. Engine-specific only: map Thrift TTypeId codes (from the result schema)
// to FieldKind. FieldMeta assembly + ChartData shape come from ./sql.
import type { ChartData, FieldKind } from "../types.js";
import { buildChartData, type SourceColumn } from "./sql.js";

// Thrift TTypeId codes (@databricks/sql TCLIService_types). These are wire-protocol constants.
const TTypeId = {
  BOOLEAN: 0,
  TINYINT: 1,
  SMALLINT: 2,
  INT: 3,
  BIGINT: 4,
  FLOAT: 5,
  DOUBLE: 6,
  STRING: 7,
  TIMESTAMP: 8,
  DECIMAL: 15,
  DATE: 17,
  VARCHAR: 18,
  CHAR: 19,
} as const;

const NUMERIC = new Set<number>([
  TTypeId.TINYINT,
  TTypeId.SMALLINT,
  TTypeId.INT,
  TTypeId.BIGINT,
  TTypeId.FLOAT,
  TTypeId.DOUBLE,
  TTypeId.DECIMAL,
]);
const TEMPORAL = new Set<number>([TTypeId.TIMESTAMP, TTypeId.DATE]);

function databricksKind(typeId: number): FieldKind {
  if (NUMERIC.has(typeId)) return "number";
  if (TEMPORAL.has(typeId)) return "time";
  if (typeId === TTypeId.BOOLEAN) return "boolean";
  return "string"; // string/varchar/char/binary/array/map/struct (stringified) ...
}

/** A Databricks result column: name + the Thrift TTypeId code. */
export interface DatabricksColumn {
  name: string;
  typeId: number;
}

/**
 * Convert a Databricks result into ChartData.
 * @param rows    Row objects from `operation.fetchAll()`.
 * @param columns Column name + TTypeId, extracted from `operation.getSchema()` (see databricksRunSql).
 */
export function databricksToChartData(rows: Record<string, unknown>[], columns: DatabricksColumn[]): ChartData {
  const cols: SourceColumn[] = columns.map((c) => ({ name: c.name, type: c.typeId }));
  return buildChartData({ rows, columns: cols, mapKind: (typeId) => databricksKind(typeId as number) });
}
