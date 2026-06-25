/**
 * Pivot tall data to wide format for multi-series charts.
 *
 * Input (tall):  [{ month, region: "EU", revenue: 29300 }, { month, region: "US", revenue: 22500 }]
 * Output (wide): [{ month, EU: 29300, US: 22500 }]
 */
export function pivotData(
  data: Record<string, unknown>[],
  xKey: string,
  pivotKey: string,
  valueKey: string,
): { data: Record<string, unknown>[]; seriesKeys: string[]; collapsed: number } {
  const seriesKeys: string[] = [];
  const seen = new Set<string>();

  for (const row of data) {
    const raw = row[pivotKey];
    const pivotValue = raw == null || raw === "" ? "(No value)" : String(raw);
    if (!seen.has(pivotValue)) {
      seen.add(pivotValue);
      seriesKeys.push(pivotValue);
    }
  }

  // Sum on collision: multiple rows for the same (x, series) cell mean the source data was
  // unaggregated. Last-write-wins would silently drop data; summing matches what a GROUP BY
  // would have produced. `collapsed` counts the extra rows folded in, for a caller advisory.
  const groups = new Map<string, Record<string, unknown>>();
  let collapsed = 0;
  for (const row of data) {
    const xValue = String(row[xKey] ?? "");
    const raw = row[pivotKey];
    const pivotValue = raw == null || raw === "" ? "(No value)" : String(raw);
    if (!groups.has(xValue)) groups.set(xValue, { [xKey]: row[xKey] });
    const group = groups.get(xValue)!;
    if (pivotValue in group) {
      collapsed++;
      group[pivotValue] = (Number(group[pivotValue]) || 0) + (Number(row[valueKey]) || 0);
    } else {
      group[pivotValue] = row[valueKey];
    }
  }

  return { data: Array.from(groups.values()), seriesKeys, collapsed };
}
