// Auto-detect a sensible chart type from the data shape, when the caller didn't force one.
import type { ChartType, FieldMeta } from "../types.js";

export function detectChartType(fields: FieldMeta[]): ChartType {
  if (fields.some((f) => f.role === "time")) return "line"; // a time axis
  if (fields.some((f) => f.role === "dimension")) return "bar"; // a category breakdown
  return "table"; // a single metric (or unknown shape)
}
