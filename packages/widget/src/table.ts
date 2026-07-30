// HTML <table> renderer. Tables aren't a charting-library job, so this stays hand-rolled
// (ECharts owns every actual chart type via spec-to-option.ts).
import type { ChartSpec, ColumnSpec } from "@bonnard/mcp-charts";
import { fmt, esc } from "./format.js";

// A 0-row result is a valid "no data" state, not a broken chart. Render an explicit, theme-aware
// empty-state marker instead of a headerless empty <table> (which reads as a blank white area).
export function renderEmptyState(): string {
  return `<div class="empty" data-empty>No data</div>`;
}

export function renderTable(spec: ChartSpec): string {
  if (spec.data.length === 0) return renderEmptyState();
  const cols: ColumnSpec[] = spec.columns?.length
    ? spec.columns
    : Object.keys(spec.data[0] ?? {}).map((k) => ({ key: k, label: k }));
  const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const rows = spec.data
    .map(
      (row) =>
        `<tr>${cols.map((c) => `<td>${esc(fmt(row[c.key], c.format, c.currency, c.fraction, false))}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<div class="tbl-scroll"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
