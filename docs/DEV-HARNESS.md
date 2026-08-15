# Widget dev harness (hot-reloading render preview)

Iterate on the chart/dashboard renderer without the build -> embed -> restart cycle.

The harness is the dev-only cousin of [embed mode](./EMBED-MODE.md): same idea (a parent page drives the
widget over postMessage), but `#harness` and the `bonnard:harness-*` messages are internal and may change
without notice. Build against `#embed` and `bonnard:render` instead.

## One command

```bash
pnpm dev:harness           # from repo root  (or: pnpm -F @bonnard/mcp-charts-widget harness)
```

Opens `packages/widget/src/harness.html` on a gallery of every example the repo has: the chart fixtures
from `packages/widget/test/fixtures.ts` and the dashboard fixtures from `@bonnard/mcp-charts/fixtures`.
Filter by chart type, by decision kind, or by free text; click a card to open it full size.

## The gallery

Each card is a static SVG thumbnail, rendered by `renderToSvg` (the same `spec-to-option` adapter the
live widget runs) and cached per theme. Under it sit the chart type, any row-count reduction
(`40 -> 30 rows`), one chip per decision the render reported, coloured by audience, and a red chip if
the example carries a cell error.

Thumbnails are static on purpose. One live iframe per card would re-execute the ECharts module graph
50 times on every filter change, which is slower than the click-through it replaces. The single live
widget lives in the overlay, where interacting with it is the point.

The sidebar lists chart types and all 19 `DecisionKind`s with counts. Clicking a kind filters to the
examples that demonstrate it, which is the fast way to find the case you are about to change.

## The overlay

Click a card. The real widget renders it in an iframe on the left; the right pane explains it.

- **Audience** (all / viewer / author / agent) sets what the widget captions, live, on the same frame.
  This is the control a QA pass spends its time in: open one example, flip all four, move on.
- **Decisions** lists every decision the render reported, with its audiences and whether the current
  filter shows it. Filtered-out rows are dimmed rather than hidden, so "why did that caption vanish"
  stays answerable from the screen that made it vanish.
- **Errors** lists hard failures (a `ChartCell.error`, a `KpiTile.error`, a JSON parse error). Never
  audience-filtered, because a failure is not an advisory.
- **JSON** shows either the input (`{ data, opts }` fed through `resolve` + `mergeAdvisories`) or the
  resolved spec. Edit it and the preview updates, debounced; Cmd-Enter renders immediately. Past 200
  rows the pane truncates and goes read-only, so a hand edit cannot silently render a shorter dataset
  than the one on screen.

`Left` and `Right` move to the previous and next example in the current filter without closing. `Esc`
closes.

## Synthetic data

The overlay footer generates data at a chosen density, in the fixture's own shape, from a seeded
generator. Row counts are fixed snap points (10, 50, 500, 2,000, 5,000, 20,000) chosen to straddle the
real caps: `MAX_BARS` 30, `MAX_POINTS` and `MAX_SCATTER_POINTS` 2,000, and `EMBED_LIMITS.maxRows`
20,000. On a continuous slider, landing on a boundary is a matter of luck.

A time x-axis steps at the declared granularity with the measures on a random walk; a categorical
x-axis gets a long-tailed distribution, so a bar cap trips the way real ranked data trips it; a scatter
gets correlated points around the original ranges. Pie, funnel and waterfall are excluded: random
values say nothing about share, stage or bridge semantics.

The fixture is never modified. "Reset to fixture data" restores it, and while synthetic data is showing,
the header carries a `synthetic: N rows, seed S` badge so the two can never be confused. The seed makes
a repro reproducible: "it broke at 5,000 rows, seed 3" is the whole bug report.

## Copy for AI

Two entry points, for two situations.

Hovering a card gives you the quick one: the fixture untouched, every audience, no hand edits. The
overlay's button gives you the full one: the audience you were looking at, the synthetic seed if any,
whether the JSON was edited, and an optional note of what looks wrong.

Both produce markdown with fenced JSON: the context, a table of the decisions with their audiences, a
hard-errors section, then the input and the resolved spec. Long arrays are cut to their first and last
10 entries with a sibling `_truncated` key giving the real total, so the JSON stays valid and never
looks shorter than it is. `decisions` and `notes` are never truncated. "Copy JSON" gives you the
resolved spec whole.

## What hot-reloads

The harness feeds the iframe exactly like a host delivers a tool result (`postMessage` ->
`main.ts`'s `#harness` hook). Specs are built by core imported **from source**, through the same
`mergeAdvisories(resolve(...))` pipeline `chart()` runs, so:

- Edit the renderer (`main.ts`, `spec-to-option.ts`, `dashboard.ts`, `table.ts`) -> the iframe
  reloads and the harness re-feeds the current payload (it pings `bonnard:harness-ready` on load).
- Edit core inference (`resolve/*`, `infer.ts`, `validate.ts`) -> the harness rebuilds and re-feeds.

Vite full-reloads the harness page itself on some edits, so the example you are looking at, the
audience, the theme, the JSON view and the synthetic seed all ride `location.hash`
(`#e=decisions-downsample-line-3000&a=author&t=dark&n=3000&s=42`). You keep your place, and the URL is
shareable. A hand edit in the JSON pane is deliberately not persisted: a stale edit silently overriding
a fixture would make the harness lie about what it is showing.

## Adding an example

Add a fixture to `packages/widget/test/fixtures.ts` and it appears in the gallery, the structural tests,
and the UAT gate. If it exists to trigger a decision, label it:

```ts
{
  name: "decisions-downsample-line-3000",
  demonstrates: ["downsample"],
  opts: { chartType: "line", title: "Sessions per day (3,000 days)" },
  data: { rows: /* ... */, fields: /* ... */ },
}
```

`demonstrates` drives the gallery chips and two tests in `test/harness-catalog.test.ts`: every
`DecisionKind` needs at least one example that declares it, and every declared kind has to actually
fire in that example's render. Adding a kind without a worked example fails there rather than shipping
an unreachable case.

A fixture that renders nothing by design (no measure column, say) declares `expect: { blank: true }`, and
the UAT gate asserts zero series plus the decision that explains it instead of looking for marks.

## Why it's safe to ship inert

`harness.html`, `harness.ts` and `src/harness/*` live in `src/`, but the production build's input is
`src/index.html` only (`vite.config.ts`), and `vite-plugin-singlefile` is gated to `command === "build"`.
None of it is bundled into the embedded widget; the `#harness` hook in `main.ts` is gated on the URL
fragment (hosts load the resource without one) and is render-only.
