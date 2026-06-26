<h1 align="center">@bonnard/mcp-charts</h1>

<p align="center">Interactive charts for your MCP server, in a few lines.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bonnard/mcp-charts"><img src="https://img.shields.io/npm/v/@bonnard/mcp-charts" alt="npm version"></a>
  <a href="https://github.com/bonnard-data/mcp-charts/actions/workflows/ci.yml"><img src="https://github.com/bonnard-data/mcp-charts/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@bonnard/mcp-charts" alt="MIT license"></a>
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

addCharts(server, {
  // your read-only query callback. Return { rows } (and optionally typed `fields`)
  runSql: async (sql) => ({ rows: await db.query(sql) }),
  discovery: { toolName: "explore_schema" }, // your schema-discovery tool
});
```

That registers a `visualize` tool and a `ui://bonnard/chart` widget resource. The agent calls it with SQL; the rows render as a chart in the host, with a text fallback for non-widget clients.

## Why

- **Grounded in real data.** Charts render the rows your query returned, not numbers the model typed into a tool call. No hallucinated figures.
- **A few lines, no frontend.** One function, one widget that works across every MCP Apps host. You don't maintain per-client rendering code.
- **Interactive, not static images.** Tooltips, legends, and axis formatting, native to the client.

<p align="center">
  <img src="https://raw.githubusercontent.com/bonnard-data/mcp-charts/main/assets/interactive-waterfall.png" alt="Interactive waterfall chart with a hover tooltip, rendered in Claude" width="820">
</p>

## Chart types

Eight types, chosen automatically from the shape of your data or set explicitly: `bar`, `line`, `area`, `pie`, `scatter`, `funnel`, `waterfall`, `table`. Plus bar variants (stacked, grouped, 100% stacked, horizontal), dual-axis combos, bubble sizing, and reference lines. See the [chart types reference](https://docs.bonnard.dev/mcp-charts/chart-types).

## Warehouse adapters

Skip writing `runSql` by hand. Each adapter wraps your driver and maps native column types to chart roles (dimension, measure, time):

```ts
import { postgresRunSql } from "@bonnard/mcp-charts/postgres";
addCharts(server, { runSql: postgresRunSql(pool) });
```

Bundled for Postgres, BigQuery, Snowflake, Databricks, and DuckDB. Each driver is an optional peer dependency, installed only if you import its subpath. See [warehouse adapters](https://docs.bonnard.dev/mcp-charts/adapters).

## Security

`visualize` executes agent-written SQL against your database. Treat it as untrusted input: connect `runSql` to a **read-only, least-privilege** role scoped to the data you want exposed. Your database permissions are the security boundary; the SDK does not sandbox queries. See [Security](https://docs.bonnard.dev/mcp-charts/getting-started#security).

## Links

- Docs: https://docs.bonnard.dev/mcp-charts/getting-started
- Website: https://bonnard.dev
- Issues: https://github.com/bonnard-data/mcp-charts/issues

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
