// The preview server: node:http only, no framework. Serves the shell page, the embedded
// production widget (at /widget, loaded by the shell's iframe with #harness), the current spec
// as JSON, an SSE channel that announces spec-version bumps, and a POST /rerun that re-invokes
// the spec source (file re-read or MCP tool re-call).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { PreviewSpec } from "./load-spec.js";
import { WIDGET_HTML } from "../generated/widget-html.js";

export interface PreviewState {
  version: number;
  payload: PreviewSpec | null;
  /** Last load/call failure; the shell shows it and keeps the last good render. */
  error: string | null;
}

export interface PreviewServerOptions {
  /** The shell page served at "/". */
  html: string;
  /** Re-invoke the spec source; called on POST /rerun. */
  rerun?: () => Promise<PreviewSpec>;
  initialPayload?: PreviewSpec;
  port?: number;
  host?: string;
  /** Override the served widget (tests); defaults to the embedded production widget. */
  widgetHtml?: string;
}

export interface PreviewServer {
  server: Server;
  port: number;
  url: string;
  state(): PreviewState;
  /** Set a new payload; no-op (no version bump, no SSE ping) when the spec is unchanged. */
  update(payload: PreviewSpec): void;
  /** Record a failure; keeps the last good payload so the chart stays up. */
  fail(error: string): void;
  close(): Promise<void>;
}

export async function startPreviewServer(opts: PreviewServerOptions): Promise<PreviewServer> {
  const widgetHtml = opts.widgetHtml ?? WIDGET_HTML;
  const state: PreviewState = { version: 0, payload: opts.initialPayload ?? null, error: null };
  let lastJson = state.payload ? JSON.stringify(state.payload) : "";
  const sseClients = new Set<ServerResponse>();

  function broadcast(): void {
    state.version += 1;
    for (const res of sseClients) res.write(`event: render\ndata: {"version":${state.version}}\n\n`);
  }

  function update(payload: PreviewSpec): void {
    const json = JSON.stringify(payload);
    if (json === lastJson && state.error === null) return;
    lastJson = json;
    state.payload = payload;
    state.error = null;
    broadcast();
  }

  function fail(error: string): void {
    if (state.error === error) return;
    state.error = error;
    broadcast();
  }

  async function rerun(): Promise<void> {
    if (!opts.rerun) return;
    try {
      update(await opts.rerun());
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  function send(res: ServerResponse, status: number, contentType: string, body: string): void {
    res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
    res.end(body);
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && path === "/") return send(res, 200, "text/html; charset=utf-8", opts.html);
    if (req.method === "GET" && path === "/widget") return send(res, 200, "text/html; charset=utf-8", widgetHtml);
    if (req.method === "GET" && path === "/spec") return send(res, 200, "application/json", JSON.stringify(state));
    if (req.method === "GET" && path === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write("retry: 1000\n\n");
      sseClients.add(res);
      res.on("close", () => sseClients.delete(res));
      return;
    }
    if (req.method === "POST" && path === "/rerun") {
      rerun()
        .then(() => send(res, 200, "application/json", JSON.stringify(state)))
        .catch(() => send(res, 500, "application/json", "{}"));
      return;
    }
    send(res, 404, "text/plain", "Not found");
  }

  const server = createServer(handle);
  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? 0);

  return {
    server,
    port,
    url: `http://${host}:${port}`,
    state: () => state,
    update,
    fail,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const res of sseClients) res.end();
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
