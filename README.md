# @bonnard/mcp-charts

Add beautiful, agent-ready visualizations to your MCP server in a few lines.

Your MCP server already has data. `@bonnard/mcp-charts` gives an agent a `visualize`
tool and renders the result as an interactive chart inside Claude and ChatGPT, with no
UI code from you. You connect your data (SQL, a semantic layer, or an ORM); we handle the
tool, the chart, the cross-host widget, and the theming.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addCharts } from "@bonnard/mcp-charts";

const server = new McpServer({ name: "acme", version: "1.0.0" });

addCharts(server, {
  // your data, your connection — Bonnard never touches the database
  async runSql(sql) {
    return pool.query(sql); // -> { rows, fields? }
  },
});
```

## How it works
- The agent calls `visualize` with a query (SQL / semantic query / chart params).
- Your callback runs it against your warehouse / ORM and returns rows.
- Bonnard infers the chart encoding from the typed result and renders it as an MCP App
  (a sandboxed `ui://` widget) in Claude or ChatGPT — one widget, both hosts.

## Status
Early development. Not yet published.

## Repo layout
- `packages/core` — the SDK (`@bonnard/mcp-charts`): the tool surface, the `resolve()`
  brain, the `ChartData` contract, the `ui://` + `_meta` emit.
- `packages/widget` — the iframe guest: thin cross-host adapter + renderer, bundled to a
  single HTML file and embedded into core.
- `examples` — runnable example servers.

## License
MIT
