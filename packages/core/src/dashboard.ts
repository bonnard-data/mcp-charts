// Runtime guards discriminating a DashboardSpec (a grid of items) from a ChartSpec (a single
// chart with a `data` array). Consumers check isDashboardSpec first: a dashboard has `items`
// and no top-level `data`; a chart has `data`.
import type { ChartSpec, DashboardSpec } from "./types.js";

export function isDashboardSpec(x: unknown): x is DashboardSpec {
  return (
    !!x &&
    typeof x === "object" &&
    Array.isArray((x as DashboardSpec).items) &&
    !Array.isArray((x as { data?: unknown }).data)
  );
}

export function isChartSpec(x: unknown): x is ChartSpec {
  return !!x && typeof x === "object" && Array.isArray((x as ChartSpec).data);
}
