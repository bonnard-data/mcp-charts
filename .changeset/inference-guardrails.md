---
"@bonnard/mcp-charts": minor
---

Inference guardrails + a typed-data path so mistakes on live, unseen data stop failing silently

When a chart is wired to a live database, a blank or wrong chart used to render with no signal.
This adds guardrails on every path (widget, agent text, and a new author-time diagnostic), plus a
first-class typed source, without breaking the raw `chart(rows, opts)` ergonomics or the
`ChartSpec` / `DashboardSpec` contracts.

- **Numeric-string recovery.** A value column that arrives as numeric strings (`revenue: "1234"` —
  common from drivers that stringify decimals/bigints) is now typed as a `number` measure during
  inference and plotted, instead of being demoted to a string dimension and producing a blank
  chart. Year-like 4-digit values (1900-2100) are left alone. An advisory note records the
  coercion.
- **Zero-series note.** Any plotting chart (everything but `table`) that resolves to no data series
  now carries a `"No measure column to plot ..."` note explaining the blank chart, covering the
  all-null-column, wrong-`fields`, and ignored-`encode` cases.
- **Notes on every surface.** Chart notes now render on the single-chart widget path and per chart
  cell in a dashboard grid (previously only top-level dashboard notes rendered), and are appended to
  the `chartSummary` / `summarizeDashboard` agent text so both the human and the model see them. The
  `warnUntypedColumns` advisories are merged into a chart's notes on the `chart` / `chartCell` path.
- **`chart` / `chartCell` accept a typed `ChartData`.** The first argument can now be raw rows
  (sniffed, unchanged) OR a `ChartData` (`{ rows, fields?, encode?, notes? }` from an adapter,
  trusting driver types with no sniff), discriminated by `Array.isArray`. A DB-connected view is
  `chart(await runSql("select ..."), { chartType: "line" })`.
- **`explain(source, opts?)`** returns a compact diagnostic (`{ fields, chartType, x, series,
  notes }`) with no render payload, so a developer can assert the encoding in a unit test / CI
  before a host renders it. Exported alongside its `ChartExplanation` return type.
- **`strict` mode** on `ResolveOptions` (threaded through `resolve` / `chart` / `explain`) turns the
  encoding-failure advisories (zero series, ignored encode column, forced-type shape mismatch) into
  thrown errors, so `explain(rows, { chartType, strict: true })` fails loudly in a test.

Also: loose non-ISO date strings (`01/15/2026`, `Jan 2025`) are noted (plotted as unordered
categories, not silently) rather than parsed; forced pie/line/funnel shape mismatches carry a
precondition note; and a phantom `encode.y` series naming an absent column is dropped so the spec
matches its "ignored" note. A shared `allNumericStrings` / `isYearLike` helper is exported from the
validation module so recovery, `warnUntypedColumns`, and the year guard agree.
