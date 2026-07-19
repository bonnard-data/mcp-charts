// Pure HTML shell for a DashboardSpec. Chart cells emit an empty placeholder that main.ts paints
// with ECharts (or a table); KPI/text cells emit their final HTML here. Mirrors table.ts: hand-
// rolled HTML, all strings escaped via `esc`. No DOM, so it is linkedom-testable and SSR-safe.
import type { ChartSpec, DashboardItem, DashboardSpec, KpiTile, TextBlock } from "@bonnard/mcp-charts";
import { fmt, esc } from "./format.js";

// Mirror core's isDashboardSpec/isChartSpec. Kept local (not imported from core) so the widget's
// dependency on @bonnard/mcp-charts stays type-only — a runtime import would invert the
// widget-before-core build order (core embeds the built widget). Same logic, covered by tests.
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

const clampCols = (n?: number) => Math.min(4, Math.max(1, n ?? 2));

// A cell's grid span, clamped to [1, columns]. `columns` is already clamped by the caller.
function cellSpan(span: number | undefined, columns: number): number {
  if (span == null) return 1;
  return Math.min(columns, Math.max(1, Math.floor(span)));
}

export function renderKpi(t: KpiTile): string {
  const value = t.value == null ? "—" : esc(fmt(t.value, t.format, t.currency, t.fraction, false));
  let delta = "";
  if (typeof t.delta === "number" && t.delta !== 0) {
    const dir = t.delta > 0 ? "up" : "down";
    const arrow = t.delta > 0 ? "▲" : "▼";
    const d = fmt(Math.abs(t.delta), t.format, t.currency, t.deltaFraction, false);
    delta = `<span class="kpi-delta ${dir}">${arrow} ${esc(d)}</span>`;
  }
  const caption = t.caption ? `<div class="kpi-caption">${esc(t.caption)}</div>` : "";
  return `<div class="kpi-label">${esc(t.label)}</div>` + `<div class="kpi-value">${value}${delta}</div>` + caption;
}

export function renderTextBlock(t: TextBlock): string {
  const heading = t.heading ? `<h3>${esc(t.heading)}</h3>` : "";
  return `${heading}<div class="text-body">${esc(t.text)}</div>`;
}

/** A chart's advisories as a muted `.cell-notes` block (blank chart, coerced columns, capped
 *  categories), or "" when there are none. Shared by the dashboard grid and the single-chart path
 *  so a chart's notes reach the human on every surface, not just the agent text. */
export function renderChartNotes(spec: ChartSpec): string {
  return spec.notes?.length ? `<div class="cell-notes">${esc(spec.notes.join(" "))}</div>` : "";
}

/** Discriminate an item: a chart cell carries `spec`; otherwise dispatch on `type`. An unknown
 *  type renders a muted placeholder so an old widget never breaks on a newer item kind. */
function renderItem(item: DashboardItem, index: number, columns: number): string {
  const span = cellSpan((item as { span?: number }).span, columns);
  const spanAttr = span > 1 ? ` data-span="${span}"` : "";
  if ("spec" in item) {
    // main.ts paints the chart into #cell-<i>; a per-cell note (blank chart, coerced columns,
    // capped categories) renders here as a sibling so the human sees it, mirroring dash-notes.
    return `<div class="cell chart"${spanAttr}><div class="cell-chart" id="cell-${index}"></div>${renderChartNotes(item.spec)}</div>`;
  }
  if (item.type === "kpi") return `<div class="cell kpi"${spanAttr}>${renderKpi(item)}</div>`;
  if (item.type === "text") return `<div class="cell text-block"${spanAttr}>${renderTextBlock(item)}</div>`;
  return `<div class="cell unsupported"${spanAttr}>Unsupported item</div>`;
}

/** Title + `.grid` shell. Chart cells are empty placeholders (`#cell-<i>`); kpi/text are final. */
export function renderDashboardShell(spec: DashboardSpec): string {
  const columns = clampCols(spec.columns);
  const title = spec.title ? `<div class="dash-title">${esc(spec.title)}</div>` : "";
  const cells = spec.items.map((item, i) => renderItem(item, i, columns)).join("");
  const grid = `<div class="grid" style="--cols:${columns}">${cells}</div>`;
  const notes = spec.notes?.length ? `<div class="dash-notes">${esc(spec.notes.join(" "))}</div>` : "";
  return `${title}${grid}${notes}`;
}
