// Runtime validation for the embed message contract. The wire TYPES and the published caps live in
// core (packages/core/src/embed.ts) so they ship on the public package; this module implements the
// checks the widget actually enforces.
//
// The caps are duplicated here on purpose, mirroring dashboard.ts: the widget's dependency on
// @bonnard/mcp-charts stays TYPE-ONLY, because a runtime import would invert the build order (core
// embeds the built widget). `test-embed-limits-parity` fails if the two copies drift.
import type { ChartSpec, DashboardItem, DashboardSpec } from "@bonnard/mcp-charts";

/** A payload the widget can render: a whole chart, a whole dashboard, or one bare cell. */
export type EmbedPayload = ChartSpec | DashboardSpec | DashboardItem;

/** Why a render was refused. Mirrors core's BonnardErrorCode. */
export type BonnardErrorCode =
  | "invalid-payload"
  | "payload-too-large"
  | "item-not-found"
  | "invalid-item-selector"
  | "render-failed";

/** Every message the widget can post its parent in embed mode. Mirrors core's union. */
export type BonnardWidgetMessage =
  | { type: "bonnard:ready"; protocolVersion: number }
  | { type: "bonnard:size"; height: number; width: number; sizing: "content" }
  | { type: "bonnard:error"; code: BonnardErrorCode; message: string; renderId?: string };

/** Bounds on a render payload. Mirrors core's EMBED_LIMITS; kept in sync by a parity test. */
export const EMBED_LIMITS = {
  maxRows: 20_000,
  maxItems: 100,
  maxSeries: 64,
  maxRowKeys: 128,
  maxStringLength: 10_000,
  maxNotes: 50,
  maxNodes: 200_000,
} as const;

/** A validation failure: the code the parent sees plus a human-readable reason. */
export interface EmbedValidationError {
  code: BonnardErrorCode;
  message: string;
}

const err = (code: BonnardErrorCode, message: string): EmbedValidationError => ({ code, message });

/**
 * Structural validation of a render payload, with caps. Returns null when the payload is safe to
 * render, or the reason it was refused. Deliberately conservative: it accepts the documented
 * shapes and refuses everything else, rather than rendering "undefined" for a near-miss.
 */
export function validatePayload(payload: unknown): EmbedValidationError | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return err("invalid-payload", "payload must be a ChartSpec, DashboardSpec, or DashboardItem object");
  }
  const budget = { nodes: 0 };
  const size = checkSize(payload, budget);
  if (size) return size;

  if (isDashboardSpecShape(payload)) return validateDashboard(payload as DashboardSpec);
  if (isChartSpecShape(payload)) return validateChart(payload as ChartSpec, "payload");
  return validateItem(payload, "payload");
}

/** `items` array and no top-level `data`: the DashboardSpec discriminant. */
export function isDashboardSpecShape(x: unknown): boolean {
  return (
    !!x && typeof x === "object" && Array.isArray((x as DashboardSpec).items) && !Array.isArray((x as ChartSpec).data)
  );
}

/** A `data` array: the ChartSpec discriminant. */
export function isChartSpecShape(x: unknown): boolean {
  return !!x && typeof x === "object" && Array.isArray((x as ChartSpec).data);
}

function validateDashboard(spec: DashboardSpec): EmbedValidationError | null {
  if (spec.items.length > EMBED_LIMITS.maxItems) {
    return err("payload-too-large", `dashboard has ${spec.items.length} items (max ${EMBED_LIMITS.maxItems})`);
  }
  if (spec.title !== undefined && !isBoundedString(spec.title)) {
    return err("invalid-payload", "dashboard title must be a string within the length cap");
  }
  const notes = validateNotes(spec.notes, "dashboard");
  if (notes) return notes;
  for (let i = 0; i < spec.items.length; i++) {
    const e = validateItem(spec.items[i], `items[${i}]`);
    if (e) return e;
  }
  return null;
}

function validateItem(item: unknown, where: string): EmbedValidationError | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return err("invalid-payload", `${where} must be a dashboard item object`);
  }
  const it = item as { spec?: unknown; type?: unknown; id?: unknown; span?: unknown };
  if (it.id !== undefined && !isBoundedString(it.id)) {
    return err("invalid-payload", `${where}.id must be a string`);
  }
  if (it.span !== undefined && !isFiniteNumber(it.span)) {
    return err("invalid-payload", `${where}.span must be a number`);
  }
  // A chart cell is discriminated by `spec`, checked before `type` so `{type:"chart"}` alone fails.
  if ("spec" in it) {
    if (!isChartSpecShape(it.spec)) return err("invalid-payload", `${where}.spec must be a ChartSpec`);
    return validateChart(it.spec as ChartSpec, `${where}.spec`);
  }
  if (it.type === "kpi") return validateKpi(item as Record<string, unknown>, where);
  if (it.type === "text") return validateText(item as Record<string, unknown>, where);
  return err("invalid-payload", `${where} is not a chart cell, kpi, or text item`);
}

function validateKpi(t: Record<string, unknown>, where: string): EmbedValidationError | null {
  if (!isBoundedString(t.label)) return err("invalid-payload", `${where}.label must be a string`);
  const v = t.value;
  if (!(v === null || v === undefined || isFiniteNumber(v) || isBoundedString(v))) {
    return err("invalid-payload", `${where}.value must be a number, string, or null`);
  }
  for (const key of ["delta", "fraction", "deltaFraction"] as const) {
    const raw = t[key];
    if (raw === undefined) continue;
    const ok = key === "delta" ? isFiniteNumber(raw) : typeof raw === "boolean";
    if (!ok) return err("invalid-payload", `${where}.${key} has the wrong type`);
  }
  for (const key of ["caption", "format", "currency"] as const) {
    if (t[key] !== undefined && !isBoundedString(t[key])) {
      return err("invalid-payload", `${where}.${key} must be a string`);
    }
  }
  return null;
}

function validateText(t: Record<string, unknown>, where: string): EmbedValidationError | null {
  if (!isBoundedString(t.text)) return err("invalid-payload", `${where}.text must be a string`);
  if (t.heading !== undefined && !isBoundedString(t.heading)) {
    return err("invalid-payload", `${where}.heading must be a string`);
  }
  return null;
}

function validateChart(spec: ChartSpec, where: string): EmbedValidationError | null {
  if (!Array.isArray(spec.data)) return err("invalid-payload", `${where}.data must be an array`);
  if (spec.data.length > EMBED_LIMITS.maxRows) {
    return err("payload-too-large", `${where}.data has ${spec.data.length} rows (max ${EMBED_LIMITS.maxRows})`);
  }
  if (!isBoundedString(spec.chartType)) {
    return err("invalid-payload", `${where}.chartType must be a string`);
  }
  if (spec.title !== undefined && !isBoundedString(spec.title)) {
    return err("invalid-payload", `${where}.title must be a string`);
  }
  const notes = validateNotes(spec.notes, where);
  if (notes) return notes;

  // A table renders from `columns`; every other chart type needs `series`.
  if (spec.chartType === "table") {
    if (spec.columns !== undefined) {
      if (!Array.isArray(spec.columns)) return err("invalid-payload", `${where}.columns must be an array`);
      if (spec.columns.length > EMBED_LIMITS.maxSeries) {
        return err("payload-too-large", `${where}.columns exceeds ${EMBED_LIMITS.maxSeries}`);
      }
      for (const c of spec.columns) {
        if (!c || typeof c !== "object" || !isBoundedString((c as { key?: unknown }).key)) {
          return err("invalid-payload", `${where}.columns entries need a string key`);
        }
      }
    }
  } else {
    if (!Array.isArray(spec.series)) return err("invalid-payload", `${where}.series must be an array`);
    if (spec.series.length > EMBED_LIMITS.maxSeries) {
      return err("payload-too-large", `${where}.series exceeds ${EMBED_LIMITS.maxSeries}`);
    }
    for (const s of spec.series) {
      if (!s || typeof s !== "object" || !isBoundedString((s as { key?: unknown }).key)) {
        return err("invalid-payload", `${where}.series entries need a string key`);
      }
    }
    // `x` is what the categories come from; a non-string here renders an axis of "undefined".
    if (spec.x !== undefined && !isBoundedString(spec.x)) {
      return err("invalid-payload", `${where}.x must be a string`);
    }
  }

  for (const row of spec.data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return err("invalid-payload", `${where}.data rows must be objects`);
    }
    const keys = Object.keys(row);
    if (keys.length > EMBED_LIMITS.maxRowKeys) {
      return err("payload-too-large", `${where}.data row has ${keys.length} keys (max ${EMBED_LIMITS.maxRowKeys})`);
    }
  }
  return null;
}

function validateNotes(notes: unknown, where: string): EmbedValidationError | null {
  if (notes === undefined) return null;
  if (!Array.isArray(notes)) return err("invalid-payload", `${where}.notes must be an array`);
  if (notes.length > EMBED_LIMITS.maxNotes) {
    return err("payload-too-large", `${where}.notes exceeds ${EMBED_LIMITS.maxNotes}`);
  }
  if (!notes.every(isBoundedString)) return err("invalid-payload", `${where}.notes must be strings`);
  return null;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const isBoundedString = (v: unknown): v is string => typeof v === "string" && v.length <= EMBED_LIMITS.maxStringLength;

/**
 * Walk the payload once to bound total nodes and string sizes, so a deeply nested or
 * string-bomb message is refused before any renderer touches it.
 */
function checkSize(value: unknown, budget: { nodes: number }, depth = 0): EmbedValidationError | null {
  if (++budget.nodes > EMBED_LIMITS.maxNodes) {
    return err("payload-too-large", `payload exceeds ${EMBED_LIMITS.maxNodes} values`);
  }
  if (depth > 12) return err("payload-too-large", "payload nests deeper than 12 levels");
  if (typeof value === "string") {
    return value.length > EMBED_LIMITS.maxStringLength
      ? err("payload-too-large", `a string exceeds ${EMBED_LIMITS.maxStringLength} characters`)
      : null;
  }
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const e = checkSize(v, budget, depth + 1);
      if (e) return e;
    }
    return null;
  }
  for (const v of Object.values(value)) {
    const e = checkSize(v, budget, depth + 1);
    if (e) return e;
  }
  return null;
}

/**
 * Resolve which dashboard cell a render message selected. Fails closed: an unusable selector is an
 * error rather than a silent fall back to the whole grid, which would leak other cells into the
 * caller's layout.
 */
export function selectItem(
  spec: DashboardSpec,
  selector: { item?: unknown; itemId?: unknown },
): { item: DashboardItem } | EmbedValidationError | null {
  const { item, itemId } = selector;
  if (itemId !== undefined) {
    if (typeof itemId !== "string" || !itemId) {
      return err("invalid-item-selector", "itemId must be a non-empty string");
    }
    const found = spec.items.find((i) => (i as { id?: string }).id === itemId);
    if (!found) return err("item-not-found", `no dashboard item has id ${JSON.stringify(itemId)}`);
    return { item: found };
  }
  if (item === undefined || item === null) return null; // no selection: render the whole dashboard
  if (typeof item !== "number" || !Number.isInteger(item)) {
    return err("invalid-item-selector", "item must be an integer index");
  }
  if (item < 0 || item >= spec.items.length) {
    return err("item-not-found", `item index ${item} is out of range (0..${spec.items.length - 1})`);
  }
  return { item: spec.items[item]! };
}
