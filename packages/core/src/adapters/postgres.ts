// Postgres -> ChartData adapter. Engine-specific pieces only: the OID -> FieldKind map and a
// date-safe cell normalizer. Works for any driver whose result exposes { name, dataTypeID } columns
// (node-postgres and PGlite both do). FieldMeta assembly + ChartData shape come from ./sql.
import type { ChartData, FieldKind } from "../types.js";
import { buildChartData, defaultNormalizeCell, type SourceColumn } from "./sql.js";

// Postgres builtin type OIDs. These are fixed system-catalog identifiers (part of the wire
// protocol), stable across versions — the same constants pg-types ships as `builtins`.
const OID = {
  BOOL: 16,
  INT8: 20,
  INT2: 21,
  INT4: 23,
  OID: 26,
  FLOAT4: 700,
  FLOAT8: 701,
  NUMERIC: 1700,
  DATE: 1082,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
} as const;

const NUMERIC = new Set<number>([OID.INT8, OID.INT2, OID.INT4, OID.OID, OID.FLOAT4, OID.FLOAT8, OID.NUMERIC]);
const TEMPORAL = new Set<number>([OID.DATE, OID.TIMESTAMP, OID.TIMESTAMPTZ]);

function pgKind(oid: number): FieldKind {
  if (NUMERIC.has(oid)) return "number"; // pg returns int8/numeric as strings; buildChartData coerces
  if (TEMPORAL.has(oid)) return "time";
  if (oid === OID.BOOL) return "boolean";
  return "string"; // text/varchar/json/uuid/time/arrays (stringified) ...
}

// pg parses date/timestamp columns to JS Date. For DATE, format from local components (pg builds the
// Date at local midnight) to avoid a UTC day-shift; timestamps keep full ISO. Everything else uses
// the shared default (numeric-string -> number, arrays/objects -> stringified).
function pgNormalize(value: unknown, kind: FieldKind, column: SourceColumn): unknown {
  if (kind === "time" && value instanceof Date) {
    if (column.type === OID.DATE) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, "0");
      const d = String(value.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return value.toISOString();
  }
  return defaultNormalizeCell(value, kind);
}

/** A Postgres result column: name + the type OID (`dataTypeID` from pg/PGlite result `fields`). */
export interface PostgresField {
  name: string;
  dataTypeID: number;
}

/**
 * Convert a Postgres result into ChartData.
 * @param rows   Result rows (objects), as returned by node-postgres or PGlite (`result.rows`).
 * @param fields Result columns (`result.fields`: name + dataTypeID).
 */
export function postgresToChartData(rows: Record<string, unknown>[], fields: PostgresField[]): ChartData {
  const columns: SourceColumn[] = fields.map((f) => ({ name: f.name, type: f.dataTypeID }));
  return buildChartData({ rows, columns, mapKind: (oid) => pgKind(oid as number), normalizeCell: pgNormalize });
}
