// Example: return a DashboardSpec from an MCP tool. The `sales_dashboard` tool composes KPIs +
// charts + a text block into one grid; the embedded ui:// widget renders it as a dashboard.
//   pnpm install && pnpm start   (from the repo root: pnpm build first, so workspace:* has the exports)
// Serves MCP over Streamable HTTP at /mcp; point a remote MCP client (Claude Desktop custom
// connector, Cursor, or `npx @modelcontextprotocol/inspector`) at http://localhost:3000/mcp.
//
// No database here on purpose: a DashboardSpec can come from any tool. Chart cells are built with
// chartCell(rows, opts), which infers the encoding from the raw rows via resolve().
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { addDashboardTool, chartCell, type DashboardSpec } from "@bonnard/mcp-charts";

// 1. In-memory data (in real life this is your warehouse / API / analytics store).
type RegionRow = { region: string; revenue: number };
type MonthRow = { month: string; revenue: number };
type StatusRow = { status: string; orders: number };

const MONTHLY: MonthRow[] = [
  { month: "2026-01-01", revenue: 42000 },
  { month: "2026-02-01", revenue: 38500 },
  { month: "2026-03-01", revenue: 51200 },
  { month: "2026-04-01", revenue: 47800 },
  { month: "2026-05-01", revenue: 55400 },
  { month: "2026-06-01", revenue: 61900 },
];

const BY_REGION: RegionRow[] = [
  { region: "EU", revenue: 128900 },
  { region: "US", revenue: 142300 },
  { region: "APAC", revenue: 65600 },
];

const ORDERS_BY_STATUS: StatusRow[] = [
  { status: "shipped", orders: 812 },
  { status: "open", orders: 143 },
  { status: "cancelled", orders: 37 },
];

// Prior-period revenue, for the KPI delta.
const PRIOR_TOTAL_REVENUE = 275_000;

/** Compose the DashboardSpec for a region (or all regions when unset). */
function buildDashboard(region?: string): DashboardSpec {
  const regionRows = region ? BY_REGION.filter((r) => r.region === region) : BY_REGION;
  const scale = region ? (regionRows[0]?.revenue ?? 0) / totalRevenue(BY_REGION) : 1;

  // When filtered to a region, scale the monthly/order figures so the tiles and charts agree.
  const monthly = MONTHLY.map((m) => ({ ...m, revenue: Math.round(m.revenue * scale) }));
  const totalRev = Math.round(totalRevenue(regionRows));
  const totalOrders = Math.round(sum(ORDERS_BY_STATUS.map((o) => o.orders)) * scale);
  const priorRev = Math.round(PRIOR_TOTAL_REVENUE * scale);

  const scope = region ? `${region} region` : "all regions";
  return {
    title: region ? `Sales Dashboard (${region})` : "Sales Dashboard",
    columns: 2,
    items: [
      {
        type: "kpi",
        label: "Total revenue",
        value: totalRev,
        format: "currency",
        currency: "USD",
        delta: totalRev - priorRev,
        caption: "vs prior period",
      },
      {
        type: "kpi",
        label: "Orders",
        value: totalOrders,
        caption: "this period",
      },
      chartCell(monthly, { chartType: "line", title: "Revenue by month", span: 2 }),
      chartCell(regionRows, { chartType: "bar", title: "Revenue by region" }),
      {
        type: "text",
        heading: "Summary",
        text: `Revenue for ${scope} is trending up month over month, led by the EU and US.`,
      },
    ],
  };
}

const totalRevenue = (rows: RegionRow[]) => sum(rows.map((r) => r.revenue));
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

// 3. Build a fresh MCP server (widget resource + the sales_dashboard tool). One instance per
// Streamable HTTP session, the standard sessioned pattern. addDashboardTool registers the widget
// resource + the tool (outputSchema, widget _meta, result envelope, error handling).
function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "example-dashboard", version: "0.1.0" });

  addDashboardTool(
    server,
    {
      name: "sales_dashboard",
      title: "Sales dashboard",
      description:
        "Return a multi-chart sales dashboard (KPIs + charts + text) as a DashboardSpec. " +
        "Pass `region` (EU / US / APAC) to scope it to one region.",
      inputSchema: {
        region: z.enum(["EU", "US", "APAC"]).optional().describe("Filter the dashboard to one region"),
      },
    },
    (args: { region?: string }) => buildDashboard(args.region),
  );

  return server;
}

// 4. Streamable HTTP hosting. Sessioned: the first (initialize) POST creates a transport +
// server, later requests reuse it via the mcp-session-id header.
const transports = new Map<string, StreamableHTTPServerTransport>();

// CORS is essential for browser-based clients (Inspector) and Claude Desktop remote connectors:
// allow the MCP headers on requests and EXPOSE mcp-session-id so the client can read + echo it.
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, mcp-session-id, mcp-protocol-version, last-event-id",
  );
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
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

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // Reuse an existing session's transport for GET (SSE), DELETE (teardown), and follow-up POSTs.
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    const body = req.method === "POST" ? await readBody(req).catch(() => undefined) : undefined;
    await transport.handleRequest(req, res, body);
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(400).end("Missing or unknown mcp-session-id");
    return;
  }

  // A POST without a known session: only a valid initialize request may open one.
  const body = await readBody(req).catch(() => undefined);
  if (!isInitializeRequest(body)) {
    res.writeHead(400).end("Bad Request: expected an initialize request to open a session");
    return;
  }

  const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id: string) => {
      transports.set(id, transport);
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) transports.delete(transport.sessionId);
  };

  const server = buildMcpServer();
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
  console.error(`example-dashboard MCP server on http://localhost:${PORT}/mcp`);
});
