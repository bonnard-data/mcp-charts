// HTML <table> renderer. Tables aren't a charting-library job, so this stays hand-rolled
// (ECharts owns every actual chart type via spec-to-option.ts).
import type { ChartSpec, ColumnSpec } from "@bonnard/mcp-charts";
import { fmt, esc } from "./format.js";

export function renderTable(spec: ChartSpec): string {
  const cols: ColumnSpec[] = spec.columns?.length
    ? spec.columns
    : Object.keys(spec.data[0] ?? {}).map((k) => ({ key: k, label: k }));
  const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const rows = spec.data
    .map((row) => `<tr>${cols.map((c) => `<td>${esc(fmt(row[c.key], c.format, c.currency))}</td>`).join("")}</tr>`)
    .join("");
  return `<table class="tbl"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}
