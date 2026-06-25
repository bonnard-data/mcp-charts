// Shared adapter core. An adapter's only engine-specific jobs are (a) report each column's engine
// type, (b) map that type to a FieldKind, and (c) normalize a cell to a flat scalar. The rest —
// assembling typed FieldMeta (with name-based format/granularity hints), the ChartData shape, and
// the read-only check — lives here so every adapter shares it.
//
// Connection, auth, read-only enforcement, cost caps and timeouts belong to the caller's database
// role; assertReadOnlySql is a cheap extra check on LLM-authored SQL, not a substitute for one.
import type { ChartData, FieldKind, FieldMeta } from "../types.js";
import { roleFromKind, titleCase, formatHint, granularityHint } from "../resolve/infer.js";

/** A source column: its name + the engine's declared type, in whatever shape the driver reports. */
export interface SourceColumn {
  name: string;
  /** Engine type, passed verbatim to mapKind (e.g. "INT64", a Postgres OID, "VARCHAR", a field object). */
  type: unknown;
}

/** Map an engine's column type to our FieldKind. The one piece of real per-engine work. */
export type KindMapper = (type: unknown, column: SourceColumn) => FieldKind;

/** Coerce one cell value to a flat scalar, guided by the resolved kind. */
export type CellNormalizer = (value: unknown, kind: FieldKind, column: SourceColumn) => unknown;

export interface BuildChartDataOptions {
  rows: Record<string, unknown>[];
  columns: SourceColumn[];
  mapKind: KindMapper;
  /** Optional; defaults to {@link defaultNormalizeCell}, which suits drivers that return JS-native values. */
  normalizeCell?: CellNormalizer;
}

/** Default cell normalizer: pass scalars through, coerce numbers/booleans, stringify non-scalars.
 *  Handles `{ value }` wrapper objects (some drivers wrap typed values). Adapters whose driver
 *  needs special handling (e.g. BigQuery's typed-string + wrapper mix) supply their own. */
export function defaultNormalizeCell(value: unknown, kind: FieldKind): unknown {
  if (value == null) return null;
  const obj = typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (kind === "number") {
    const raw = obj ? ("value" in obj ? obj.value : (value as { toString(): string }).toString()) : value;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === "boolean") {
    if (typeof value === "boolean") return value;
    const s = String(obj && "value" in obj ? obj.value : value).toLowerCase();
    return s === "true" || s === "1" ? true : s === "false" || s === "0" ? false : null;
  }
  if (kind === "time") {
    if (obj && "value" in obj) return String(obj.value);
    return value instanceof Date ? value.toISOString() : typeof value === "string" ? value : String(value);
  }
  // string-ish: unwrap { value }, stringify arrays/objects so the scalar guard passes, else pass through.
  if (obj) {
    if (Array.isArray(value)) return JSON.stringify(value);
    if ("value" in obj) return String(obj.value);
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Turn a SQL result (rows + column types) into typed ChartData. Builds a complete FieldMeta per
 * column from the engine kind + name-based format/granularity hints, then normalizes every cell.
 */
export function buildChartData({ rows, columns, mapKind, normalizeCell = defaultNormalizeCell }: BuildChartDataOptions): ChartData {
  const fields: FieldMeta[] = columns.map((col) => {
    const kind = mapKind(col.type, col);
    const format = kind === "number" ? formatHint(col.name) : undefined;
    const granularity = kind === "time" ? granularityHint(col.name) : undefined;
    return {
      name: col.name,
      kind,
      role: roleFromKind(kind),
      label: titleCase(col.name),
      ...(format && { format }),
      ...(granularity && { granularity }),
    };
  });
  const kindByName = new Map(fields.map((f) => [f.name, f.kind!]));
  const out = rows.map((row) => {
    const r: Record<string, unknown> = {};
    for (const col of columns) r[col.name] = normalizeCell(row[col.name], kindByName.get(col.name)!, col);
    return r;
  });
  return { rows: out, fields };
}

/**
 * Reject anything that isn't a single SELECT/WITH statement. A cheap check on LLM-authored SQL;
 * enforce real read-only access with a database role.
 */
export function assertReadOnlySql(sql: string): void {
  const t = sql.trim().replace(/;\s*$/, "");
  if (/;/.test(t)) throw new Error("Only a single statement is allowed.");
  if (!/^(select|with)\b/i.test(t)) throw new Error("Only read-only SELECT queries are allowed.");
  if (/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|call|export|load|copy|execute|attach|vacuum|lock)\b/i.test(t)) {
    throw new Error("Write/DDL statements are not allowed.");
  }
}
