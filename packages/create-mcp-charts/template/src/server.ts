// A minimal MCP server with agent-ready charts, built on @bonnard/mcp-charts.
//
// `explore_views` lists the views this server exposes; `render_view` renders one by id into the
// embedded ui:// chart widget. This starter ships ONE sample view — a revenue-by-region bar chart.
// Add your own by pushing more entries onto VIEWS: return a ChartSpec via chart(rows, opts), or a
// DashboardSpec of KPIs + chart cells (see chartCell). Swap the in-memory rows for your real data
// source (a warehouse query, an API call) inside each view's render().
//
//   npm install && npm start
// Serves MCP over Streamable HTTP at http://localhost:3000/mcp. Point a remote MCP client (Claude
// Desktop custom connector, Cursor, or `npx @modelcontextprotocol/inspector`) at that URL.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { addDashboardViews, chart, type ChartSpec, type ViewDef } from "@bonnard/mcp-charts";

// 1. Your data. In real life this comes from a warehouse query or an API; here it is in memory.
const REVENUE_BY_REGION = [
  { region: "EU", revenue: 128900 },
  { region: "US", revenue: 142300 },
  { region: "APAC", revenue: 65600 },
];

const buildRevenueByRegion = (): ChartSpec =>
  chart(REVENUE_BY_REGION, { chartType: "bar", title: "Revenue by region" });

// 2. The views registry. One sample view; add more here.
const VIEWS: ViewDef[] = [
  {
    id: "revenue_by_region",
    title: "Revenue by region",
    description: "A bar chart of revenue by region",
    kind: "chart",
    render: () => buildRevenueByRegion(),
  },
];

// 3. Build a fresh MCP server per request (widget resource + explore_views + render_view).
function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "__PROJECT_NAME__", version: "0.1.0" });
  addDashboardViews(server, { views: VIEWS });
  return server;
}

// 4. Stateless Streamable HTTP hosting: a fresh server + transport per request, no sessions. A
// server restart stays invisible to the client (there is no session to invalidate).
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, mcp-protocol-version");
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on("error", reject);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/mcp") {
    res.writeHead(404).end("Not found");
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  const body = await readBody(req).catch(() => undefined);
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

const httpServer = createServer((req, res) => {
  void handleRequest(req, res).catch((err) => {
    console.error("request error:", err);
    if (!res.headersSent) res.writeHead(500).end("Internal error");
  });
});

const PORT = Number(process.env.PORT ?? 3000);
httpServer.listen(PORT, () => {
  console.error(`MCP server on http://localhost:${PORT}/mcp`);
});
