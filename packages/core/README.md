<h1 align="center">@bonnard/mcp-charts</h1>

<p align="center">Interactive charts, dashboards, and named views for your MCP server, in a few lines.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bonnard/mcp-charts"><img src="https://img.shields.io/npm/v/@bonnard/mcp-charts" alt="npm version"></a>
  <a href="https://github.com/bonnard-data/mcp-charts/actions/workflows/ci.yml"><img src="https://github.com/bonnard-data/mcp-charts/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@bonnard/mcp-charts" alt="MIT license"></a>
</p>

<p align="center">
  Built by <a href="https://bonnard.dev">Bonnard</a> &middot; <a href="https://docs.bonnard.dev/mcp-charts/getting-started">Docs</a>
</p>

`@bonnard/mcp-charts` adds interactive charts to any MCP server. Your agent asks for data, your
database returns the rows, and the result renders as an interactive chart inside the host (Claude,
ChatGPT, and other MCP Apps clients). You write no frontend code: one widget renders across every host.

> Pre-1.0: the API may change before a 1.0 release.

## Install

```bash
npm install @bonnard/mcp-charts
```

## Two ways to add charts

There are two shapes, depending on who chooses the query:

- **Ad-hoc `visualize` (the agent writes SQL).** Add a generic `visualize` tool with `addCharts`. The
  agent writes SQL against your warehouse and the rows render as a chart. Best for open-ended
  exploration.
- **Named views (you author the queries).** Register named, reviewed views with `addViews`. Each view
  returns a single chart or a full dashboard, and the agent picks a view instead of writing SQL. Best
  for trusted, repeatable analytics.

Both paths render through the same `ui://bonnard/chart` widget and the same encoding logic.

## Quickstart: the `visualize` tool

Call `addCharts` on your existing MCP server and give it a read-only query callback:

```ts
import { addCharts } from "@bonnard/mcp-charts";
import { postgresRunSql } from "@bonnard/mcp-charts/postgres";

addCharts(server, {
  runSql: postgresRunSql(pool), // maps pg column types to chart field kinds
  discovery: { toolName: "explore_schema" }, // tell the agent to discover tables first
});
```

That registers a `visualize` tool and a `ui://bonnard/chart` widget resource. The agent calls it with
SQL; the rows render as a chart in the host, with a text fallback for non-widget clients.

Adapters ship for `postgres`, `bigquery`, `snowflake`, `databricks`, and `duckdb`. For an engine
without one, build typed `ChartData` with `buildChartData` (or declare `fields` yourself) so
numeric/temporal columns aren't inferred from raw driver values — see
[Connecting a database](#connecting-a-database).

## Chart types

Eight types, chosen automatically from the shape of your data or set explicitly: `bar`, `line`,
`area`, `pie`, `scatter`, `funnel`, `waterfall`, `table`. Plus bar variants (stacked, grouped, 100%
stacked, horizontal), dual-axis combos, bubble sizing, and reference lines. See the
[chart types reference](https://docs.bonnard.dev/mcp-charts/chart-types).

## Named views (charts and dashboards)

When you author the queries, register named **views** with `addViews`. It registers two tools over a
registry: `explore_views` lists what's available (id, title, description, params) and `render_view`
renders one by `view_id` (a single `ChartSpec` via `chart(rows, opts)`, or a composed
`DashboardSpec`), binding the result to the widget. Each `ViewDef` can declare zod `params` that
`render_view` validates per view.

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

## Connecting a database

When you build views from live, unseen data, prefer a **typed source**. An adapter (or
`buildChartData`) hands `resolve()` a `ChartData` with column types from your driver, so the encoding
is decided from types, not sniffed from a sample:

```ts
import { chart, buildChartData } from "@bonnard/mcp-charts";

// A typed ChartData is accepted anywhere raw rows are — same one line, driver types instead of a sniff.
const data = buildChartData({ rows, columns, mapKind }); // or an adapter's runSql(...)
const spec = chart(data, { chartType: "line" });
```

`chart(rows, opts)` and `chart(chartData, opts)` are the same call: pass raw `Record<string, unknown>[]`
to sniff, or a `{ rows, fields?, encode?, notes? }` to trust declared types.

**Numbers must arrive as numbers.** Some drivers stringify decimals/bigints (`revenue: "1234"`).
Inference recovers all-numeric-string columns to a measure and adds an advisory note, but the robust
fix is to declare the column's `kind` (via `fields` or an adapter) or cast in SQL. `fields` and
`encode` are trusted verbatim: a wrong declaration is honored, so a mistyped measure yields a blank
series (with a note).

To catch these before a host renders, assert the encoding in a test with `explain()`:

```ts
import { explain } from "@bonnard/mcp-charts";

expect(explain(sampleRows, { chartType: "bar" }).series.length).toBeGreaterThan(0);
// or fail loud on a bad encoding:
explain(sampleRows, { chartType: "bar", strict: true }); // throws on zero series / ignored encode
```

See the [connecting-a-database guide](https://docs.bonnard.dev/mcp-charts/connecting-a-database) for
the full DB-correctness story and a troubleshooting table.

## Warehouse adapters

Skip writing `runSql` by hand. Each adapter wraps your driver and maps native column types to chart
roles (dimension, measure, time):

```ts
import { postgresRunSql } from "@bonnard/mcp-charts/postgres";
addCharts(server, { runSql: postgresRunSql(pool) });
```

Bundled for Postgres, BigQuery, Snowflake, Databricks, and DuckDB. Each driver is an optional peer
dependency, installed only if you import its subpath. See
[warehouse adapters](https://docs.bonnard.dev/mcp-charts/adapters).

## Exports at a glance

| Export                        | What it does                                                        |
| ----------------------------- | ------------------------------------------------------------------- |
| `addCharts`                   | Register the ad-hoc `visualize` tool (agent writes SQL).            |
| `addViews`                    | Register `explore_views` + `render_view` over a set of named views. |
| `chart` / `chartCell`         | Build a `ChartSpec` / dashboard cell from rows or typed `ChartData`. |
| `explain`                     | Diagnose the encoding in a test, without rendering.                 |
| `resolve` / `inferFields`     | The pure encoding brain and its field inference.                    |
| `buildChartData`, `defaultNormalizeCell`, `assertReadOnlySql` | Adapter authoring kit.              |

Full details in the [API reference](https://docs.bonnard.dev/mcp-charts/api-reference).

## Security

`visualize` executes agent-written SQL against your database. Treat it as untrusted input: connect
`runSql` to a **read-only, least-privilege** role scoped to the data you want exposed. Your database
permissions are the security boundary; the SDK does not sandbox queries. See
[Security](https://docs.bonnard.dev/mcp-charts/getting-started#security).

## Links

- Docs: https://docs.bonnard.dev/mcp-charts/getting-started
- Website: https://bonnard.dev
- Issues: https://github.com/bonnard-data/mcp-charts/issues

## License

MIT
