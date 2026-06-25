# Quickstart — charts on an MCP server

The smallest possible example of [`@bonnard/mcp-charts`](../../packages/core): an MCP server that
adds a `visualize` tool + interactive chart widget on top of a tiny SQLite database.

The whole integration is one line:

```ts
addCharts(server, { runSql, discovery: { toolName: "explore_schema" } });
```

`runSql` is your read-only query callback — swap the in-memory SQLite in `src/server.ts` for your
own database driver and you're done.

## Run

```bash
pnpm install
pnpm start            # serves over stdio
```

Then point an MCP client at the stdio command:

- **Inspector:** `npx @modelcontextprotocol/inspector tsx src/server.ts`
- **Claude Desktop / Cursor:** add a server whose command runs this file, e.g.
  ```json
  { "command": "tsx", "args": ["/abs/path/to/examples/quickstart/src/server.ts"] }
  ```

Ask the agent things like *"show revenue by region"*, *"monthly revenue trend"*, or *"revenue by
plan as a pie chart"* — it calls `explore_schema`, writes SQL, and `visualize` renders the chart.
