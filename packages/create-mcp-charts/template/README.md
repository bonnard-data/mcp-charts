# __PROJECT_NAME__

An MCP server with agent-ready charts, built on [`@bonnard/mcp-charts`](https://github.com/bonnard-data/mcp-charts).

## Run

```bash
npm install
npm start
```

Serves MCP over Streamable HTTP at `http://localhost:3000/mcp`. Point a remote MCP client at that URL:

- Claude Desktop: add a custom connector with the URL above.
- Cursor: add an MCP server pointing at the URL.
- Inspector: `npx @modelcontextprotocol/inspector` (transport: streamable-http).

## What's here

- `src/server.ts` — a stateless Streamable HTTP MCP server exposing two tools:
  - `explore_views` — lists the available views.
  - `render_view` — renders one view into the embedded chart widget.

It ships one sample view (`revenue_by_region`, a bar chart).

## Add a view

Push another entry onto `VIEWS` in `src/server.ts`. Each view's `render()` returns either:

- a **ChartSpec** — `chart(rows, { chartType: "line", title: "..." })`, or
- a **DashboardSpec** — a grid of KPI tiles, text, and chart cells (`chartCell(rows, opts)`).

Swap the in-memory rows for a real query (your warehouse, an API) inside `render()`. `chart`/`chartCell`
also accept a typed `ChartData` from an adapter, so the encoding rides declared column types.
