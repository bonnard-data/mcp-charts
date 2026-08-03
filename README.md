<h1 align="center">@bonnard/mcp-charts</h1>

<p align="center">Interactive charts for your MCP server, in a few lines.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bonnard/mcp-charts"><img src="https://img.shields.io/npm/v/@bonnard/mcp-charts" alt="npm version"></a>
  <a href="https://github.com/bonnard-data/mcp-charts/actions/workflows/ci.yml"><img src="https://github.com/bonnard-data/mcp-charts/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@bonnard/mcp-charts" alt="MIT license"></a>
</p>

<p align="center">
  Built by <a href="https://bonnard.dev">Bonnard</a> &middot; <a href="https://docs.bonnard.dev/mcp-charts/getting-started">Docs</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/bonnard-data/mcp-charts/main/assets/hero-bubble.png" alt="A chart rendered inside Claude from a visualize tool call" width="820">
</p>

`@bonnard/mcp-charts` adds a `visualize` tool plus an embedded chart widget to any MCP server. The agent writes SQL, your database returns the rows, and the result renders as an interactive chart inside the host (Claude, ChatGPT, and other MCP Apps clients). You write no frontend code.

> Pre-1.0: the API may change before a 1.0 release.

## Install

```bash
npm install @bonnard/mcp-charts
```

## Quickstart

Call `addCharts` on your existing MCP server and give it a read-only query callback:

```ts
import { addCharts } from "@bonnard/mcp-charts";
import { postgresRunSql } from "@bonnard/mcp-charts/postgres";

addCharts(server, {
  runSql: postgresRunSql(pool), // maps pg column types to chart field kinds
  discovery: { toolName: "explore_schema" }, // tell the agent to discover tables first
});
```

That registers a `visualize` tool and a `ui://bonnard/chart` widget resource. The agent calls it
with SQL; the rows render as a chart in the host, with a text fallback for non-widget clients.

Adapters ship for `postgres`, `bigquery`, `snowflake`, `databricks`, and `duckdb`. For an engine
without one, build typed `ChartData` with `buildChartData` (or declare `fields` yourself) so
numeric/temporal columns aren't inferred from raw driver values.

## How it works
- The agent calls `visualize` with a query (SQL / semantic query / chart params).
- Your callback runs it against your warehouse / ORM and returns rows.
- Bonnard infers the chart encoding from the typed result and renders it as an MCP App
  (a sandboxed `ui://` widget) in Claude or ChatGPT. One widget, both hosts.

## Why

- **Grounded in real data.** Charts render the rows your query returned, not numbers the model typed into a tool call. No hallucinated figures.
- **A few lines, no frontend.** One function, one widget that works across every MCP Apps host. You don't maintain per-client rendering code.
- **Interactive, not static images.** Tooltips, legends, and axis formatting, native to the client.

<p align="center">
  <img src="https://raw.githubusercontent.com/bonnard-data/mcp-charts/main/assets/interactive-waterfall.png" alt="Interactive waterfall chart with a hover tooltip, rendered in Claude" width="820">
</p>

## Chart types

Eight types, chosen automatically from the shape of your data or set explicitly: `bar`, `line`, `area`, `pie`, `scatter`, `funnel`, `waterfall`, `table`. Plus bar variants (stacked, grouped, 100% stacked, horizontal), dual-axis combos, bubble sizing, and reference lines. See the [chart types reference](https://docs.bonnard.dev/mcp-charts/chart-types).

## Named views (charts and dashboards)

When you author the queries instead of letting the agent write SQL, register named **views** with
`addViews`. It registers two tools over a registry: `explore_views` lists what's available (id, title,
description, params) and `render_view` renders one by `view_id`, binding the result to the widget.
Each `ViewDef` returns a single `ChartSpec` (via `chart(rows, opts)`) or a composed `DashboardSpec`,
and can declare zod `params` that `render_view` validates per view.

```ts
import { addViews, chart, chartCell } from "@bonnard/mcp-charts";
import { z } from "zod";

addViews(server, {
  views: [
    {
      id: "revenue_trend",
      title: "Revenue trend",
      description: "Monthly revenue",
      kind: "chart",
      render: () => chart(monthlyRows, { chartType: "line", title: "Revenue by month" }),
    },
    {
      id: "sales_overview",
      title: "Sales overview",
      description: "KPIs + charts, optionally per region",
      kind: "dashboard",
      params: { region: z.enum(["EU", "US", "APAC"]).optional() },
      render: ({ region }) => ({
        title: "Sales overview",
        columns: 2,
        items: [
          { type: "kpi", label: "Revenue", value: 336800, format: "currency", currency: "USD", delta: 61800 },
          chartCell(monthlyRows, { chartType: "line", title: "Revenue by month", span: 2, id: "revenue_by_month" }),
          chartCell(regionRows, { chartType: "bar", title: "Revenue by region", id: "revenue_by_region" }),
        ],
      }),
    },
  ],
});
```

A `dashboard`-kind view returns a `DashboardSpec` (a grid of chart cells, KPI tiles, and text blocks);
`chartCell` builds a cell from raw rows. Give a cell an `id` and the agent can re-render it alone by
passing `render_view` an `item_id` (the ids appear in the dashboard summary). See `examples/dashboard`
for a six-view server, the [views guide](https://docs.bonnard.dev/mcp-charts/views), and the
[dashboards reference](https://docs.bonnard.dev/mcp-charts/dashboards) for the `DashboardSpec` shape.

## Embed the widget in your own UI

Embed mode renders a single chart, KPI, or table with no chrome of its own, for your own admin console or app rather than an MCP host.

Serve the widget from any route, point an iframe at `#embed`, and post it a spec:

```ts
import { WIDGET_HTML } from "@bonnard/mcp-charts";
app.get("/chart-widget", (_req, res) => res.type("html").send(WIDGET_HTML));
```

```html
<style>
  .my-card {
    height: 260px;
  }
  .my-card iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }
</style>
<div class="my-card">
  <iframe id="rev" src="/chart-widget#embed" sandbox="allow-scripts"></iframe>
</div>

<script>
  const frame = document.getElementById("rev");
  window.addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow) return;
    if (e.data?.type === "bonnard:ready")
      frame.contentWindow.postMessage({ type: "bonnard:render", payload: spec, theme: "light" }, "*");
    if (e.data?.type === "bonnard:size") {
      // "content" carries a height to apply; "fill" means release yours and let your layout decide.
      if (e.data.sizing === "content") frame.style.height = e.data.height + "px";
      else frame.style.removeProperty("height");
    }
  });
</script>
```

`#embed` drops the widget's own padding, cell borders, and title, so your card provides the chrome. KPI, text, and table cells report their content height over `bonnard:size` (`sizing: "content"`), so you can fit the frame to them. Charts fill the container you give them and report `sizing: "fill"` with no height, telling you to release any height you had applied. Always branch on `sizing`.

`payload` takes a `ChartSpec`, a bare `DashboardItem`, or a whole `DashboardSpec` with `itemId` (or `item: n`) to render just that cell. `sandbox="allow-scripts"` is all the widget needs, and theming goes through a bounded token set rather than CSS overrides. Tokens theme the HTML surface, not chart internals. The message types ship with the package, so TypeScript consumers can import `BonnardRenderMessage` and friends instead of copying them out of prose.

See [docs/EMBED-MODE.md](./docs/EMBED-MODE.md) for the flags, messages, tokens, and the stability contract, plus `examples/embed/` for a runnable page.

## Warehouse adapters

Skip writing `runSql` by hand. Each adapter wraps your driver and maps native column types to chart roles (dimension, measure, time):

```ts
import { postgresRunSql } from "@bonnard/mcp-charts/postgres";
addCharts(server, { runSql: postgresRunSql(pool) });
```

Bundled for Postgres, BigQuery, Snowflake, Databricks, and DuckDB. Each driver is an optional peer dependency, installed only if you import its subpath. See [warehouse adapters](https://docs.bonnard.dev/mcp-charts/adapters).

## Connecting a database

When you build views from live, unseen data, prefer a **typed source**. An adapter (or `buildChartData`) hands `resolve()` a `ChartData` with column types from your driver, so the encoding is decided from types, not sniffed from a sample:

```ts
import { chart, buildChartData } from "@bonnard/mcp-charts";

// A typed ChartData is accepted anywhere raw rows are — same one line, driver types instead of a sniff.
const data = buildChartData({ rows, columns, mapKind }); // or an adapter's runSql(...)
const spec = chart(data, { chartType: "line" });
```

`chart(rows, opts)` and `chart(chartData, opts)` are the same call: pass raw `Record<string, unknown>[]` to sniff, or a `{ rows, fields?, encode?, notes? }` to trust declared types.

**Numbers must arrive as numbers.** Some drivers stringify decimals/bigints (`revenue: "1234"`). Inference recovers all-numeric-string columns to a measure and adds an advisory note, but the robust fix is to declare the column's `kind` (via `fields` or an adapter) or cast in SQL. `fields` and `encode` are trusted verbatim: a wrong declaration is honored, so a mistyped measure yields a blank series (with a note).

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Blank chart, "No measure column to plot" note | value column arrived as strings, or a `fields`/`encode` declaration left no measure | return numbers (not numeric strings), or declare the column `kind: "number"` |
| Bar/line over "dates" isn't sorted; "looks like non-ISO dates" note | dates are strings in a loose format (`01/15/2026`, `Jan 2025`) | return ISO dates (`YYYY-MM-DD`) so the axis sorts chronologically |
| Multi-slice pie / odd funnel, with a precondition note | forced a chart type whose shape needs a category + a measure | supply one dimension + one measure, or drop the forced `chartType` |
| Ignored encode column note | `encode.x`/`encode.y` names a column not in the result | fix the column name (the note lists the available columns) |

To catch these before a host renders, assert the encoding in a test with `explain()`:

```ts
import { explain } from "@bonnard/mcp-charts";

expect(explain(sampleRows, { chartType: "bar" }).series.length).toBeGreaterThan(0);
// or fail loud on a bad encoding:
explain(sampleRows, { chartType: "bar", strict: true }); // throws on zero series / ignored encode
```

See the [connecting-a-database guide](https://docs.bonnard.dev/mcp-charts/connecting-a-database) for the full DB-correctness story.

## Security

`visualize` executes agent-written SQL against your database. Treat it as untrusted input: connect `runSql` to a **read-only, least-privilege** role scoped to the data you want exposed. Your database permissions are the security boundary; the SDK does not sandbox queries. See [Security](https://docs.bonnard.dev/mcp-charts/getting-started#security).

## Links

- Website: https://bonnard.dev
- Docs: https://docs.bonnard.dev/mcp-charts/getting-started
- Changelog: https://github.com/bonnard-data/mcp-charts/blob/main/packages/core/CHANGELOG.md
- Issues: https://github.com/bonnard-data/mcp-charts/issues
- Contact: [alex@bonnard.ai](mailto:alex@bonnard.ai)

## Repo layout

This is a pnpm monorepo.

- `packages/core` — the SDK (`@bonnard/mcp-charts`): the `visualize` tool, the `resolve()` encoding logic, the `ChartData` contract, and the `ui://` widget resource.
- `packages/widget` — the in-iframe renderer (ECharts), bundled to a single HTML file and embedded into core.
- `examples` — runnable example servers.

## Development

```bash
pnpm install
pnpm build       # widget -> core (embeds the widget)
pnpm check       # format, lint, typecheck
pnpm test
```

## License

MIT
