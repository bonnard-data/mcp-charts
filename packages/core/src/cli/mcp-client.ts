// Minimal Streamable HTTP MCP client for the preview CLI: initialize -> initialized -> tools/call
// over plain fetch, zero deps. Handles both application/json and text/event-stream response
// framing, and echoes mcp-session-id for sessioned servers (stateless servers issue none).
import { coerceSpec, type PreviewSpec } from "./load-spec.js";

/** A user-facing MCP failure; the CLI prints `message` (and the preview error bar shows it). */
export class McpClientError extends Error {}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface ToolContent {
  type: string;
  text?: string;
}

/** Accept a bare origin (append /mcp) or a full endpoint URL. */
export function normalizeMcpUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new McpClientError(`invalid --mcp URL "${input}" (expected e.g. http://localhost:3000/mcp)`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new McpClientError(`--mcp URL must be http(s), got "${input}"`);
  }
  if (url.pathname === "" || url.pathname === "/") url.pathname = "/mcp";
  return url.toString();
}

/** Pull the JSON-RPC response with a matching id out of an SSE body (data: lines per event). */
export function parseSseJsonRpc(body: string, id: number | string): JsonRpcResponse | undefined {
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    for (const msg of Array.isArray(parsed) ? parsed : [parsed]) {
      const rpc = msg as JsonRpcResponse;
      if (rpc && typeof rpc === "object" && rpc.id === id && ("result" in rpc || "error" in rpc)) return rpc;
    }
  }
  return undefined;
}

interface Session {
  sessionId?: string;
  protocolVersion?: string;
}

async function post(url: string, message: unknown, session: Session): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (session.sessionId) headers["mcp-session-id"] = session.sessionId;
  if (session.protocolVersion) headers["mcp-protocol-version"] = session.protocolVersion;
  try {
    return await fetch(url, { method: "POST", headers, body: JSON.stringify(message) });
  } catch (err) {
    const reason = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
    throw new McpClientError(`cannot reach MCP server at ${url}: ${reason}. Is your server running?`);
  }
}

async function request(
  url: string,
  method: string,
  params: unknown,
  id: number,
  session: Session,
): Promise<Record<string, unknown>> {
  const res = await post(url, { jsonrpc: "2.0", id, method, params }, session);
  const body = await res.text();
  if (!res.ok) {
    throw new McpClientError(`${method} failed: HTTP ${res.status}${body ? ` ${body.slice(0, 300)}` : ""}`);
  }
  const newSession = res.headers.get("mcp-session-id");
  if (newSession) session.sessionId = newSession;

  const contentType = res.headers.get("content-type") ?? "";
  let rpc: JsonRpcResponse | undefined;
  if (contentType.includes("text/event-stream")) {
    rpc = parseSseJsonRpc(body, id);
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new McpClientError(`${method} failed: server returned non-JSON (${contentType || "no content-type"})`);
    }
    rpc = (Array.isArray(parsed) ? parsed : [parsed]).find((m) => (m as JsonRpcResponse).id === id) as
      | JsonRpcResponse
      | undefined;
  }
  if (!rpc) throw new McpClientError(`${method} failed: no JSON-RPC response for request id ${id} in server reply`);
  if (rpc.error) throw new McpClientError(`${method} failed: ${rpc.error.message}`);
  return rpc.result ?? {};
}

export interface McpToolCallResult {
  spec: PreviewSpec;
  /** The text-content summary the tool returned alongside the spec, if any. */
  summary?: string;
}

/**
 * Call one tool on a Streamable HTTP MCP server and extract the ChartSpec/DashboardSpec from
 * structuredContent. Runs the full handshake per call: stateless servers (the common consumer
 * shape, e.g. examples/dashboard) require nothing less, and sessioned servers get a fresh session.
 */
export async function callMcpTool(
  url: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<McpToolCallResult> {
  const endpoint = normalizeMcpUrl(url);
  const session: Session = {};

  const init = await request(
    endpoint,
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-charts-preview", version: "0.0.0" },
    },
    0,
    session,
  );
  if (typeof init.protocolVersion === "string") session.protocolVersion = init.protocolVersion;

  const notifyRes = await post(endpoint, { jsonrpc: "2.0", method: "notifications/initialized" }, session);
  void notifyRes.body?.cancel().catch(() => {});

  const result = await request(endpoint, "tools/call", { name: tool, arguments: args }, 1, session);
  const content = Array.isArray(result.content) ? (result.content as ToolContent[]) : [];
  const text = content.find((c) => c.type === "text")?.text;
  if (result.isError) {
    throw new McpClientError(`tool "${tool}" returned an error: ${text ?? "(no error text)"}`);
  }
  const spec = coerceSpec(result.structuredContent, `tool "${tool}" structuredContent`);
  return { spec, summary: text };
}
