// The preview CLI's minimal Streamable HTTP client, exercised against a real stateless server
// built exactly like examples/dashboard (fresh McpServer + transport per request, SSE responses).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { callMcpTool, McpClientError, normalizeMcpUrl, parseSseJsonRpc } from "../src/cli/mcp-client.js";
import { addViews, chart } from "../src/views.js";

const ROWS = [
  { month: "2026-01-01", revenue: 100 },
  { month: "2026-02-01", revenue: 200 },
];

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "test-dashboard", version: "0.0.0" });
  addViews(server, {
    views: [
      {
        id: "revenue_trend",
        title: "Revenue trend",
        description: "line of monthly revenue",
        kind: "chart",
        render: () => chart(ROWS, { chartType: "line", title: "Monthly revenue" }),
      },
      {
        id: "broken",
        title: "Broken view",
        description: "always throws",
        kind: "chart",
        render: () => {
          throw new Error("boom from view");
        },
      },
    ],
  });
  return server;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

let httpServer: Server;
let baseUrl: string;

beforeAll(async () => {
  httpServer = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      const server = buildMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  const addr = httpServer.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  httpServer.closeAllConnections();
  await new Promise<void>((r) => httpServer.close(() => r()));
});

describe("normalizeMcpUrl", () => {
  it("appends /mcp to a bare origin", () => {
    expect(normalizeMcpUrl("http://localhost:3000")).toBe("http://localhost:3000/mcp");
  });

  it("keeps an explicit path", () => {
    expect(normalizeMcpUrl("http://localhost:3000/custom")).toBe("http://localhost:3000/custom");
  });

  it("rejects a non-URL", () => {
    expect(() => normalizeMcpUrl("localhost:notaport")).toThrowError(McpClientError);
  });
});

describe("parseSseJsonRpc", () => {
  it("finds the response with the matching id across events", () => {
    const body =
      `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n` +
      `event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n`;
    expect(parseSseJsonRpc(body, 1)?.result).toEqual({ ok: true });
  });

  it("joins multi-line data fields", () => {
    const body = `data: {"jsonrpc":"2.0",\ndata: "id":7,"result":{"a":1}}\n\n`;
    // SSE joins data lines with \n, which is whitespace inside JSON.
    expect(parseSseJsonRpc(body, 7)?.result).toEqual({ a: 1 });
  });

  it("returns undefined when no matching id exists", () => {
    expect(parseSseJsonRpc(`data: {"jsonrpc":"2.0","id":2,"result":{}}\n\n`, 1)).toBeUndefined();
  });
});

describe("callMcpTool (against a real stateless Streamable HTTP server)", () => {
  it("initializes, calls the tool, and extracts the ChartSpec from structuredContent", async () => {
    const { spec, summary } = await callMcpTool(baseUrl, "render_view", { view_id: "revenue_trend" });
    expect("chartType" in spec && spec.chartType).toBe("line");
    expect("data" in spec && spec.data).toHaveLength(2);
    expect(summary).toContain("Monthly revenue");
  });

  it("surfaces a tool isError result as an McpClientError with the tool's text", async () => {
    await expect(callMcpTool(baseUrl, "render_view", { view_id: "broken" })).rejects.toThrowError(/boom from view/);
  });

  it("rejects a tool whose result is not a spec (explore_views returns a catalog)", async () => {
    await expect(callMcpTool(baseUrl, "explore_views", {})).rejects.toThrowError(/not a ChartSpec or DashboardSpec/);
  });

  it("fails with a JSON-RPC error message for an unknown tool", async () => {
    await expect(callMcpTool(baseUrl, "no_such_tool", {})).rejects.toThrowError(McpClientError);
  });

  it("fails fast with an actionable message when the server is unreachable", async () => {
    await expect(callMcpTool("http://127.0.0.1:9/mcp", "render_view", {})).rejects.toThrowError(
      /cannot reach MCP server/,
    );
  });
});
