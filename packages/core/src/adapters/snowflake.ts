// Snowflake -> ChartData. Engine-specific only: map Snowflake's logical column types (as reported
// by snowflake-sdk's Column.getType()) to FieldKind, plus date-safe normalization. FieldMeta
// assembly + ChartData shape come from ./sql.
import type { ChartData, FieldKind } from "../types.js";
import { buildChartData, defaultNormalizeCell, type SourceColumn } from "./sql.js";

// snowflake-sdk Column.getType() returns lowercase logical types:
// NUMBER/DECIMAL/INT -> "fixed", FLOAT/DOUBLE -> "real", VARCHAR/STRING -> "text", etc.
const NUMERIC = new Set(["fixed", "real"]);
const TEMPORAL = new Set(["date", "timestamp_ltz", "timestamp_ntz", "timestamp_tz"]);

function snowflakeKind(type: string): FieldKind {
  const t = type.toLowerCase();
  if (NUMERIC.has(t)) return "number";
  if (TEMPORAL.has(t)) return "time";
  if (t === "boolean") return "boolean";
  return "string"; // text, time, variant, object, array, binary, ...
}

// Snowflake DATE columns come back as JS Date (UTC midnight); keep the calendar day. Timestamps
// keep full ISO. Everything else uses the shared default (numeric coercion, non-scalar stringify).
function snowflakeNormalize(value: unknown, kind: FieldKind, column: SourceColumn): unknown {
  if (kind === "time" && value instanceof Date && String(column.type).toLowerCase() === "date") {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return defaultNormalizeCell(value, kind);
}

/** A Snowflake result column: name + the logical type from `Column.getType()`. */
export interface SnowflakeColumn {
  name: string;
  type: string;
}

/**
 * Convert a Snowflake result into ChartData.
 * @param rows    Row objects from the `complete(err, stmt, rows)` callback (rowMode "object").
 * @param columns Column name + logical type, from `stmt.getColumns().map(c => ({ name: c.getName(), type: c.getType() }))`.
 */
export function snowflakeToChartData(rows: Record<string, unknown>[], columns: SnowflakeColumn[]): ChartData {
  const cols: SourceColumn[] = columns.map((c) => ({ name: c.name, type: c.type }));
  return buildChartData({
    rows,
    columns: cols,
    mapKind: (type) => snowflakeKind(type as string),
    normalizeCell: snowflakeNormalize,
  });
}
