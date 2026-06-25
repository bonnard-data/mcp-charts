# Chart data edge cases — research synthesis (2026-06-22)

Cross-referenced four sources to harden our SQL-to-chart pipeline against dirty, LLM-written
data: our **own prior art** (`~/Projects/semantic/packages/charts`), **Evidence.dev** (ECharts-based,
vendored at `semantic/.reference/evidence`), **Metabase** (ECharts-era viz layer), and **Lightdash**
(TS + ECharts). The framing difference that drives everything: those tools get types, roles,
granularity, and pivoting *for free* from a semantic layer / warehouse metadata. **We get raw rows
from agent-written SQL** and must infer all of it, and the SQL is frequently unaggregated, untyped,
and unordered. So our highest-value work is the inference + cleanup layer, not the renderer.

## What we already handle well (validated by prior art)

- **null/empty x → "(No value)"** — we do this; Evidence/Lightdash do NOT (they render literal `null`). We exceed them.
- **pie drops non-positive slices** — safer than Lightdash (which naively sums negatives). (gap: all-negative, see below)
- **numeric-string measure coercion** (`resolve.ts:26-35`) — matches all sources.
- **percent auto-detect** `|n|<=1 ? n*100 : n` (`format.ts`) — matches semantic's `0.042→4.2%` vs `42→42%` heuristic.
- **stacked100 zero-total guard** (`spec-to-option.ts`, `totals[i] ? … : 0`) — matches semantic's `total===0` guard.
- **time-gap fill with a 10k cap** (`fill-time.ts:72`) — identical to semantic (`MAX_INTERVALS`) and Metabase (`MAX_FILL_COUNT`).
- **fill-time sorts by date** (`fill-time.ts:21`) — handles unordered time rows on the pivot/granularity path.
- **coarse-time as a category axis** — our adapter always uses `type:'category'` with pre-formatted labels, which is exactly what Lightdash forces for week/month/quarter/year to avoid phantom ECharts time ticks.
- **auto-horizontal bar >8 categories** — cardinality-driven; Lightdash/Evidence only flip on explicit user setting.
- **ISO-date value sniffing** — necessary capability the metadata-driven tools don't even have.
- **raw table passthrough** (resolve.ts table branch) — matches semantic `DataTable`.

## Implementation status (2026-06-22)

- **P0 — DONE.** Duplicate-x / (x,series) auto-aggregation with a `notes[]` advisory (`pivot.ts`, `resolve.ts aggregateByX`); numeric grouping column promoted to x (`resolve.ts`).
- **P1 — DONE.** Sort time/numeric x ascending (`sortRowsByX`); pie top-N + sub-2% "Other" bucketing; stacked missing-combo zero-fill + non-stacked null-gap rendering (`spec-to-option.ts`).
- **P2 — DONE (partial, by design).** Pie all-negative → magnitudes; all-null-x → explicit error. **Deferred:** stable series colors (intra-chart collision risk outweighs cross-chart benefit for standalone charts); stack-total labels (optional). **Verified already-safe:** timezone/UTC (fmtX formats in UTC, sort parses to ms only).
- **ECharts techniques — DONE (targeted).** `axisLine.onZero:false` (negatives no longer cut by the axis), `axisLabel.hideOverlap`, per-series `tooltip.valueFormatter`. **Not adopted:** the `dataset.source`+`encode` rewrite — lateral for our pre-pivoted/pre-formatted data and complicates stacked100/date-labels; manual `series[].data` kept.
- **Dual-axis — DONE.** `encode.y2` puts measure(s) on a secondary right axis drawn as a line over the primary chart (`SeriesSpec.axis`, `ChartSpec.yAxisRight`); per-axis formatters, right gridlines suppressed, stacking/horizontal disabled when dual.
- **High-cardinality guardrails — DONE (from an adversarial Claude Desktop run).** Three real gaps found and fixed: (1) **context flood** — `buildResult` echoed the *entire* dataset as text on top of structuredContent; now capped to a 50-row sample (`ECHO_SAMPLE`). (2) **bars/series uncapped** while pie was capped — categorical bars now keep top 30 by value + a "top N of M" note (drop tail, no misleading "Other" bar on a ranking); pivot series keep top 11 + an "Other" series (stacked is part-to-whole, so the total is preserved). (3) dense **line/area left uncapped** — many time points are legitimate; the echo cap handles their token cost. Verified e2e: 1000-cat bar → 30 rows + ~1KB echo; 24 series → 12.
- **Edge-case fixtures + tests — DONE.** The checklist below is covered by resolve() unit tests (gap-fill, null/empty dim → "(No value)", boolean → Yes/No, auto-horizontal threshold, duplicate-x, numeric-x, sort, pie Other, all-negative pie, all-null-x, dual-axis) and visual fixtures (sparse-gaps line, high-cardinality pie → Other, null-dimension bar, net-flow negatives, combo dual-axis), plus `fmt`/`fmtX` format tests. Totals: core 40, widget 21, acme 7.

## Gaps, prioritized

### P0 — correctness on dirty LLM SQL (multi-source consensus)

1. **Auto-aggregate duplicate x / (x, series).**
   - Observed live: the "Raw Amounts, Duplicate Months" test produced 16 overlapping bars instead of 3 summed ones.
   - Metabase sums duplicate (x, series) datums and emits an `unaggregatedDataWarning` (`dataset.ts:101-133`). Semantic does NOT (passes through; pivot is last-write-wins, `pivot.ts:50`). Evidence/Lightdash pivot in SQL so never hit it.
   - **Action:** in `resolve()`, before pivot, group by x (and series) and sum measures when duplicate keys exist; attach a non-fatal note ("data looked unaggregated, summed N rows"). Biggest single correctness win for our input profile.

2. **Numeric grouping column treated as a measure (no dimension → wrong fallback).**
   - `infer.ts:20` maps every `number` kind to role `measure`. A result like `{year:2024, revenue:…}` has two measures, no dimension, so it falls back to a table instead of a bar/line over year.
   - Metabase's #1 takeaway: an explicit x-axis **scale cascade** — `histogram → timeseries → linear-numeric → ordinal` (`cartesian-chart.ts:280`, `lib/numeric.ts`). A numeric x gets a true linear axis with computed tick interval, not equal-width categories.
   - **Action (two parts):** (a) role heuristic — when there's no time/string dimension but ≥2 numeric columns, treat the first/lowest-cardinality numeric as the x dimension; (b) optionally emit a numeric (`value`) axis with computed spacing rather than category. Part (a) is the urgent correctness fix; (b) is polish.

### P1 — robustness / coverage

3. **Sort guard for unordered non-granularity data.** fill-time only sorts when granularity is set. A time field without granularity, or a numeric x, can zig-zag if the SQL omits ORDER BY. Semantic's ECharts layer sorts ISO-date x ascending (`build-series.ts:56-64`). **Action:** sort by x ascending for time/numeric x regardless of granularity.

4. **High-cardinality guard: top-N + "Other".**
   - Observed live: the 8-slice pie degraded (sub-1% slivers unreadable).
   - Metabase pie collapses slices below a % threshold into "Other", but only when **>1** slice is sub-threshold and total>0 (`pie/model/index.ts:158-207`). Cartesian high-cardinality: Metabase caps at 100 series (errors); Lightdash uses a `columnLimit`; semantic/Evidence do nothing.
   - **Action:** top-N + "Other" bucket for pie; a series cap (+ scroll/truncated legend, which ECharts already gives us) for many-series cartesian.

5. **Dual-axis / combo (bar + line).** Evidence, Lightdash, Metabase all support a secondary y-axis routed by `yAxisIndex`, with per-axis type/bounds and per-series formatters. We don't. Common ask ("revenue bars + margin% line"). **Action:** add `yAxisIndex` routing + a second `yAxis`; gate splitlines to single-axis; disable auto-range on bar axes (Lightdash `useEchartsCartesianConfig.ts:1702-1784`).

6. **Categorical gap alignment for stacked/grouped.** Evidence cross-joins distinct-x × distinct-series and inserts null/0 (`getCompletedData.js`) so stacks don't shift on missing combinations. ECharts tolerates missing series values as gaps for grouped bars (we saw APAC-only-free render fine), but **stacked** can misalign. **Action:** verify stacked bars/areas with missing combos; zero-fill missing (x,series) cells for stacked modes.

### P2 — polish

7. **Stable series colors.** We (and semantic) use positional `PALETTE[j % n]`, so adding/removing a series reshuffles all colors. Since LLM series sets vary run-to-run, hash series name → palette index for stability. A place to beat the prior art.

8. **Pie all-negative fallback.** We drop non-positive, so an all-negative pie renders empty. Metabase uses `abs(value)` when *all* values are negative (`pie/model/index.ts:337`). **Action:** if all slices ≤0, plot magnitudes; else keep current drop.

9. **Timezone / UTC discipline.** Risk of off-by-one days: a wall-clock DATE parsed as an instant. Semantic appends `Z` (`fill-time.ts parseUTC`); Lightdash `useUTC:true` + never shift DATE, only TIMESTAMP. **Action:** audit `fmtX`/fill-time date parsing for DATE vs TIMESTAMP; ensure no local-tz drift in the iframe.

10. **All-null x column → explicit error.** Evidence throws "Column X is entirely null" (`getCompletedData.js:52`). We'd render something confusing. **Action:** detect + return a friendly error.

11. **Stack-total labels.** ECharts can't natively label a stack total; Evidence/Lightdash add a synthetic transparent series carrying the total (`Bar.svelte:236-272`, Lightdash `getStackTotalSeries:2453`). **Action:** optional, add when stacking is on.

## ECharts techniques worth copying (from Evidence + Lightdash)

- **`dataset.source` + per-series `encode:{x,y}`** instead of hand-built `series[].data` (Lightdash). Horizontal flip = swap `encode.x/y`. Cleaner than our current manual data arrays; worth considering for the adapter.
- **100% stacking with original values in tooltip** — transform dataset to %, pin axis `max:100`, keep an `originalValues` map so tooltip shows `"42.0% (1,234)"` (Lightdash `transformToPercentageStacking`). We already keep `{value,raw}`; this is the same idea.
- **xMismatch stringification** — when a numeric column must be a category axis, `.toString()` the values so ECharts doesn't collapse `4` vs `"4"` (Evidence `_Chart.svelte:454`).
- **Explicit `xAxis.data` on custom sort** — when sorting by category or bar-total, set `xAxis.data` to the sorted list or ECharts resorts (Lightdash `sortedAxes:3534`).
- **Zero-value label suppression** + `axisLine.onZero:false` for clean negative baselines (Evidence `Line.svelte:152`).
- **Median-based auto number format** + k/M/B/T thresholds for axis labels (Evidence `autoFormatting.js`).
- **Off-DOM label width measurement** to size grid margins and prevent label clipping (Lightdash `calculateWidthText`).
- **`carry a structured pivotReference per series`** (field + pivot value), not just a string key — needed for stable colors, per-series formatting, stack totals (Lightdash).

## Edge-case fixture checklist (build into our test suite)

Derived from semantic's fixture library (`packages/charts/dev/src/fixtures`) plus the new gaps. Each should have a resolve() unit assertion and a visual:

- single value / single row (KPI fallback, visible dot on single-point line)
- empty result (friendly state, no crash)
- duplicate x, unaggregated (→ summed, with note) **[new, P0]**
- numeric grouping column e.g. revenue-by-year-int (→ x axis, not table) **[new, P0]**
- sparse / missing time intervals (gap fill)
- missing pivot combinations (stacked alignment) **[verify]**
- negative values; mixed pos/neg; all-negative pie **[all-neg new, P2]**
- null dimension key (→ "(No value)"); boolean dimension (→ Yes/No); all-null x (→ error) **[all-null new]**
- high-cardinality categories (auto-horizontal) and high-cardinality pie (→ top-N + Other) **[pie bucket new, P1]**
- currency / percent (both 0.42 and 42 scales) / compact M/K formatting
- multi-series pivot (long→wide); multi-measure (grouped)
- dual-axis / combo **[new, P1]**
- unordered rows (→ sorted) **[new, P1]**

## Source pointers

- Prior art: `~/Projects/semantic/packages/charts/src/semantic/{resolve,pivot,fill-time,fields}.ts`, fixtures in `dev/src/fixtures/`, ECharts variant in `packages/react/src/`.
- Evidence: `.reference/evidence/packages/ui/core-components/src/lib/unsorted/viz/core/_Chart.svelte`, `packages/lib/component-utilities/src/{getSeriesConfig,getCompletedData,autoFormatting}.js`.
- Metabase: `frontend/src/metabase/visualizations/echarts/cartesian/model/{dataset,axis,other-series}.ts`, `shared/settings/cartesian-chart.ts`, `lib/{numeric,timeseries}.ts`.
- Lightdash: `packages/frontend/src/hooks/echarts/useEchartsCartesianConfig.ts`, `packages/common/src/pivot/pivotQueryResults.ts`, `packages/common/src/utils/formatting.ts`.
