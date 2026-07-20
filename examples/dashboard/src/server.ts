// Example: a multi-view dashboard surface over one MCP server. `explore_views` lists the available
// views; `render_view` renders one by id (a single ChartSpec or a composed DashboardSpec) into the
// embedded ui:// widget. Views mix single charts and dashboards across several chart types.
//   pnpm install && pnpm start   (from the repo root: pnpm build first, so workspace:* has the exports)
// Serves MCP over Streamable HTTP at /mcp; point a remote MCP client (Claude Desktop custom
// connector, Cursor, or `npx @modelcontextprotocol/inspector`) at http://localhost:3000/mcp.
//
// No database here on purpose: a spec can come from any tool. Single charts are built with
// chart(rows, opts); dashboard cells with chartCell(rows, opts). Both infer via resolve().
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  addDashboardViews,
  chart,
  chartCell,
  type ChartSpec,
  type DashboardSpec,
  type ViewDef,
} from "@bonnard/mcp-charts";

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

// Long department names + multi-million values: exercises the long-label handling (the bar flips
// horizontal so no label is dropped) and the compact large-number axis ($4M, not 4,200,000).
const DEPARTMENT_SPEND: { department: string; spend: number }[] = [
  { department: "Research and Development", spend: 4_200_000 },
  { department: "Sales and Marketing Operations", spend: 3_800_000 },
  { department: "Infrastructure and Platform Engineering", spend: 3_100_000 },
  { department: "Customer Success and Support", spend: 2_600_000 },
  { department: "General and Administrative", spend: 1_900_000 },
];

const totalRevenue = (rows: RegionRow[]) => sum(rows.map((r) => r.revenue));
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const totalOrders = () => sum(ORDERS_BY_STATUS.map((o) => o.orders));

/** Compose the sales-overview DashboardSpec for a region (or all regions when unset). */
function buildSalesOverview(region?: string): DashboardSpec {
  const regionRows = region ? BY_REGION.filter((r) => r.region === region) : BY_REGION;
  const scale = region ? (regionRows[0]?.revenue ?? 0) / totalRevenue(BY_REGION) : 1;

  // When filtered to a region, scale the monthly/order figures so the tiles and charts agree.
  const monthly = MONTHLY.map((m) => ({ ...m, revenue: Math.round(m.revenue * scale) }));
  const totalRev = Math.round(totalRevenue(regionRows));
  const orders = Math.round(totalOrders() * scale);
  const priorRev = Math.round(PRIOR_TOTAL_REVENUE * scale);

  const scope = region ? `${region} region` : "all regions";
  return {
    title: region ? `Sales Overview (${region})` : "Sales Overview",
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
      { type: "kpi", label: "Orders", value: orders, caption: "this period" },
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

/** A KPI-forward exec view: a row of KPI tiles plus one compact trend line. */
function buildExecSummary(): DashboardSpec {
  const totalRev = Math.round(totalRevenue(BY_REGION));
  const orders = totalOrders();
  const avgOrderValue = Math.round(totalRev / orders);
  return {
    title: "Executive Summary",
    columns: 3,
    items: [
      {
        type: "kpi",
        label: "Total revenue",
        value: totalRev,
        format: "currency",
        currency: "USD",
        delta: totalRev - PRIOR_TOTAL_REVENUE,
        caption: "vs prior period",
      },
      { type: "kpi", label: "Orders", value: orders, caption: "this period" },
      {
        type: "kpi",
        label: "Avg order value",
        value: avgOrderValue,
        format: "currency",
        currency: "USD",
        caption: "revenue / orders",
      },
      chartCell(MONTHLY, { chartType: "line", title: "Revenue trend", span: 3 }),
    ],
  };
}

const buildRevenueTrend = (): ChartSpec => chart(MONTHLY, { chartType: "line", title: "Monthly revenue" });

const buildRegionBreakdown = (): ChartSpec => chart(BY_REGION, { chartType: "pie", title: "Revenue by region" });

const buildOrderFunnel = (): ChartSpec => chart(ORDERS_BY_STATUS, { chartType: "funnel", title: "Orders by status" });

const buildDepartmentSpend = (): ChartSpec =>
  chart(DEPARTMENT_SPEND, { chartType: "bar", title: "Annual spend by department" });

// 2. The views registry: single charts + dashboards, varied chart types.
const VIEWS: ViewDef[] = [
  {
    id: "sales_overview",
    title: "Sales overview",
    description: "KPIs + revenue-by-month line + revenue-by-region bar + a summary, optionally per region",
    kind: "dashboard",
    params: { region: z.enum(["EU", "US", "APAC"]).optional() },
    render: (args) => buildSalesOverview(args.region as string | undefined),
  },
  {
    id: "exec_summary",
    title: "Executive summary",
    description: "A KPI-forward exec view: revenue, orders, avg order value, and a compact revenue trend",
    kind: "dashboard",
    render: () => buildExecSummary(),
  },
  {
    id: "revenue_trend",
    title: "Revenue trend",
    description: "A line chart of monthly revenue",
    kind: "chart",
    render: () => buildRevenueTrend(),
  },
  {
    id: "region_breakdown",
    title: "Region breakdown",
    description: "A pie chart of revenue by region",
    kind: "chart",
    render: () => buildRegionBreakdown(),
  },
  {
    id: "order_funnel",
    title: "Order funnel",
    description: "A funnel chart of orders by status",
    kind: "chart",
    render: () => buildOrderFunnel(),
  },
  {
    id: "department_spend",
    title: "Department spend",
    description: "A bar chart of annual spend by department (long labels + large values)",
    kind: "chart",
    render: () => buildDepartmentSpend(),
  },
];

// 3. Build a fresh MCP server (widget resource + explore_views + render_view). One instance per
// Streamable HTTP session, the standard sessioned pattern. addDashboardViews registers the widget
// resource + both tools (discovery catalog + widget-bound render, error handling).
function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "example-dashboard", version: "0.1.0" });
  addDashboardViews(server, { views: VIEWS });
  return server;
}

// 4. Streamable HTTP hosting, STATELESS: a fresh server + transport per request, no sessions. This
// keeps a server restart invisible to the client (there is no session to invalidate), so Claude
// Desktop's "reload tools" keeps working across restarts. Trade-off: no server->client push
// (notifications/SSE) - not needed here, since these tools are request/response only.

// CORS for browser-based clients (Inspector) and Claude Desktop remote connectors.
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

  // GET (SSE) and DELETE (session teardown) are session features we don't use in stateless mode.
  if (req.method !== "POST") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  // Fresh server + stateless transport per request (a shared instance would collide JSON-RPC ids
  // across concurrent clients). sessionIdGenerator: undefined = no session id, no session state.
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
  console.error(`example-dashboard MCP server on http://localhost:${PORT}/mcp`);
});
