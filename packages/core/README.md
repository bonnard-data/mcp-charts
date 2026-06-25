# @bonnard/mcp-charts

Add agent-ready, interactive charts to your MCP server in a few lines. `addCharts` registers a
`visualize` tool plus an embedded chart widget; your agent writes SQL, you run it, and the result
renders as an interactive chart inside the MCP host (Claude, ChatGPT, and other MCP Apps clients).

```bash
npm install @bonnard/mcp-charts
```

```ts
import { addCharts } from "@bonnard/mcp-charts";

addCharts(server, {
  // your read-only query callback — return { rows } (and optionally typed `fields`)
  runSql: async (sql) => ({ rows: await db.query(sql) }),
  discovery: { toolName: "explore_schema" }, // your schema-discovery tool
});
```

You own the database connection; the SDK only turns the rows into a chart. Bring your own SQL, or
use a bundled warehouse adapter (BigQuery, Postgres, DuckDB, Snowflake, Databricks):

```ts
import { postgresRunSql } from "@bonnard/mcp-charts/postgres";
addCharts(server, { runSql: postgresRunSql(pool) });
```

Full docs and examples: https://github.com/bonnard-data/mcp-charts

## License

MIT
