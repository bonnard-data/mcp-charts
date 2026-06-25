// DuckDB -> ChartData adapter. Engine-specific pieces only: the type map (DuckDBTypeId -> FieldKind)
// and the column shape. Rows come from reader.getRowObjectsJson() (JSON-safe values), so the shared
// defaultNormalizeCell handles coercion; the FieldMeta assembly and ChartData shape come from ./sql.
import { DuckDBTypeId } from "@duckdb/node-api";
import type { DuckDBType } from "@duckdb/node-api";
import type { ChartData, FieldKind } from "../types.js";
import { buildChartData, type SourceColumn } from "./sql.js";

const NUMERIC = new Set<DuckDBTypeId>([
  DuckDBTypeId.TINYINT,
  DuckDBTypeId.SMALLINT,
  DuckDBTypeId.INTEGER,
  DuckDBTypeId.BIGINT,
  DuckDBTypeId.HUGEINT,
  DuckDBTypeId.UTINYINT,
  DuckDBTypeId.USMALLINT,
  DuckDBTypeId.UINTEGER,
  DuckDBTypeId.UBIGINT,
  DuckDBTypeId.UHUGEINT,
  DuckDBTypeId.FLOAT,
  DuckDBTypeId.DOUBLE,
  DuckDBTypeId.DECIMAL,
]);
const TEMPORAL = new Set<DuckDBTypeId>([
  DuckDBTypeId.DATE,
  DuckDBTypeId.TIMESTAMP,
  DuckDBTypeId.TIMESTAMP_S,
  DuckDBTypeId.TIMESTAMP_MS,
  DuckDBTypeId.TIMESTAMP_NS,
  DuckDBTypeId.TIMESTAMP_TZ,
]);

function duckKind(typeId: DuckDBTypeId): FieldKind {
  if (NUMERIC.has(typeId)) return "number";
  if (TEMPORAL.has(typeId)) return "time";
  if (typeId === DuckDBTypeId.BOOLEAN) return "boolean";
  return "string"; // VARCHAR, TIME, BLOB, UUID, LIST/STRUCT/MAP (stringified), ...
}

/** A DuckDB result column: its name + the DuckDBType (from reader.columnTypes()). */
export interface DuckDbColumn {
  name: string;
  type: DuckDBType;
}

/**
 * Convert a DuckDB result into ChartData.
 * @param rows    Row objects from `reader.getRowObjectsJson()` (JSON-safe scalar values).
 * @param columns Column name + DuckDBType pairs (from `reader.columnNames()` + `reader.columnTypes()`).
 */
export function duckDbToChartData(rows: Record<string, unknown>[], columns: DuckDbColumn[]): ChartData {
  const cols: SourceColumn[] = columns.map((c) => ({ name: c.name, type: c.type.typeId }));
  return buildChartData({ rows, columns: cols, mapKind: (typeId) => duckKind(typeId as DuckDBTypeId) });
}
