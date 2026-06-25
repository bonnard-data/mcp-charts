// Minimal example: an MCP server that adds interactive charts to your data with @bonnard/mcp-charts.
// A tiny in-memory SQLite DB stands in for your real database — swap `runSql` for your own driver.
//   pnpm install && pnpm start
// then point an MCP client (Claude Desktop, Cursor, or `npx @modelcontextprotocol/inspector`)
// at the stdio command: `node` (or `tsx`) running this file.
import { DatabaseSync } from "node:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { addCharts } from "@bonnard/mcp-charts";

// 1. A tiny database with fake data (in real life this is your warehouse / Postgres / etc.).
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, region TEXT, plan TEXT);
  CREATE TABLE orders (id TEXT PRIMARY KEY, customer_id TEXT, amount REAL, status TEXT, created_at TEXT);
`);
const customers = [
  ["c1", "Northwind", "EU", "enterprise"],
  ["c2", "Globex", "US", "pro"],
  ["c3", "Initech", "US", "pro"],
  ["c4", "Umbrella", "EU", "enterprise"],
  ["c5", "Soylent", "APAC", "free"],
  ["c6", "Hooli", "US", "enterprise"],
  ["c7", "Stark", "EU", "pro"],
  ["c8", "Wonka", "APAC", "free"],
];
const orders = [
  ["o1", "c1", 4200, "shipped", "2026-01-08"],
  ["o2", "c1", 3100, "shipped", "2026-02-02"],
  ["o3", "c2", 900, "open", "2026-02-19"],
  ["o4", "c2", 1500, "shipped", "2026-01-21"],
  ["o5", "c3", 1200, "cancelled", "2026-01-30"],
  ["o6", "c3", 2600, "shipped", "2026-03-01"],
  ["o7", "c4", 8800, "shipped", "2026-02-11"],
  ["o8", "c4", 5400, "open", "2026-03-03"],
  ["o9", "c5", 300, "shipped", "2026-02-27"],
  ["o10", "c6", 9100, "shipped", "2026-01-14"],
  ["o11", "c6", 7300, "shipped", "2026-03-09"],
  ["o12", "c7", 2100, "open", "2026-02-28"],
  ["o13", "c7", 1800, "shipped", "2026-01-25"],
  ["o14", "c8", 250, "cancelled", "2026-02-05"],
  ["o15", "c1", 3900, "shipped", "2026-03-12"],
  ["o16", "c2", 1100, "shipped", "2026-03-15"],
];
for (const c of customers) db.prepare("INSERT INTO customers VALUES (?,?,?,?)").run(...c);
for (const o of orders) db.prepare("INSERT INTO orders VALUES (?,?,?,?,?)").run(...o);

// 2. A SQL runner — the only thing the chart tool needs from you.
async function runSql(sql: string) {
  return { rows: db.prepare(sql).all() as Record<string, unknown>[] };
}

// 3. The MCP server: a tiny schema-discovery tool so the agent can write SQL, then the chart tool.
const server = new McpServer({ name: "charts-quickstart", version: "0.1.0" });

server.registerTool(
  "explore_schema",
  { title: "Explore schema", description: "List tables and their columns so you can write SQL.", inputSchema: {} },
  async () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const schema = tables.map((t) => ({
      table: t.name,
      columns: (db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string; type: string }[]).map((c) => ({
        name: c.name,
        type: c.type,
      })),
    }));
    return { content: [{ type: "text", text: JSON.stringify(schema, null, 2) }] };
  },
);

// This one line adds the `visualize` tool + the interactive chart widget to your server.
addCharts(server, { runSql, discovery: { toolName: "explore_schema" } });

// 4. Serve over stdio.
await server.connect(new StdioServerTransport());
console.error("charts-quickstart MCP running (stdio)");
