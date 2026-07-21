#!/usr/bin/env node
// The consumer-facing preview CLI (`mcp-charts`). A separate build entry from the library:
// importing @bonnard/mcp-charts never loads this. Runtime deps are Node built-ins only.
// Design + full surface: docs/PREVIEW-CLI.md.
import { existsSync, readFileSync, watch } from "node:fs";
import { spawn } from "node:child_process";
import { basename, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadSpecFile, SpecLoadError, type PreviewSpec } from "./cli/load-spec.js";
import { callMcpTool, McpClientError } from "./cli/mcp-client.js";
import { startPreviewServer } from "./cli/preview-server.js";
import { renderShellHtml } from "./cli/shell-html.js";

const DEFAULT_PORT = 4400;
const MCP_WATCH_INTERVAL_MS = 2000;

const HELP = `mcp-charts - preview @bonnard/mcp-charts specs in the real chart widget

Usage:
  mcp-charts preview <spec.json> [options]
      Render a ChartSpec/DashboardSpec JSON file (e.g. a saved structuredContent).

  mcp-charts preview --mcp <url> --tool <name> [--args '<json>'] [options]
      Call a tool on your running Streamable HTTP MCP server and render the spec
      it returns in structuredContent. --mcp accepts an origin (/mcp is appended)
      or a full endpoint URL.

Options:
  --watch          File mode: re-render when the file changes.
                   MCP mode: re-run the tool every ${MCP_WATCH_INTERVAL_MS / 1000}s (re-renders only on change).
  --port <n>       Preview server port (default ${DEFAULT_PORT}).
  --theme <t>      Initial widget theme: light | dark (default light; toggle in the UI).
  --args <json>    JSON object of tool arguments, e.g. '{"view_id":"sales_overview"}'.
  --no-open        Do not open the browser.
  -h, --help       Show this help.
  -v, --version    Show the package version.

Examples:
  mcp-charts preview ./spec.json --watch
  mcp-charts preview --mcp http://localhost:3000 --tool render_view --args '{"view_id":"exec_summary"}'
`;

class CliError extends Error {}

function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../package.json", "../../package.json"]) {
    const path = resolvePath(here, rel);
    if (!existsSync(path)) continue;
    const pkg = JSON.parse(readFileSync(path, "utf8")) as { name?: string; version?: string };
    if (pkg.name === "@bonnard/mcp-charts" && pkg.version) return pkg.version;
  }
  return "unknown";
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CliError(`--args is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError(`--args must be a JSON object, e.g. '{"view_id":"sales_overview"}'`);
  }
  return parsed as Record<string, unknown>;
}

async function preview(positionals: string[], values: Record<string, unknown>): Promise<void> {
  const file = positionals[0];
  const mcpUrl = values.mcp as string | undefined;
  const tool = values.tool as string | undefined;
  const theme = (values.theme as string | undefined) ?? "light";
  const port = values.port !== undefined ? Number(values.port) : DEFAULT_PORT;
  const watchMode = values.watch === true;

  if (theme !== "light" && theme !== "dark") throw new CliError(`--theme must be "light" or "dark", got "${theme}"`);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CliError(`--port must be 0-65535`);
  if (file && mcpUrl) throw new CliError("pass a spec file OR --mcp, not both");
  if (!file && !mcpUrl) throw new CliError(`pass a spec file or --mcp <url> --tool <name>. See mcp-charts --help.`);
  if (mcpUrl && !tool) throw new CliError("--mcp requires --tool <name>");
  if (!mcpUrl && (tool || values.args)) throw new CliError("--tool/--args only apply with --mcp <url>");

  let source: string;
  let rerun: () => Promise<PreviewSpec>;
  if (file) {
    const path = resolvePath(file);
    source = path;
    rerun = () => Promise.resolve(loadSpecFile(path));
  } else {
    const args = parseToolArgs(values.args as string | undefined);
    source = `${tool} on ${mcpUrl}`;
    rerun = async () => (await callMcpTool(mcpUrl!, tool!, args)).spec;
  }

  // Fail fast, before the server boots: a bad file / unreachable server is a CLI error, not
  // something to discover in the browser.
  const initial = await rerun();

  const html = renderShellHtml({ source, mode: file ? "file" : "mcp", theme });
  const srv = await startPreviewServer({ html, rerun, initialPayload: initial, port }).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new CliError(`port ${port} is in use; pass --port <n> to pick another`);
    }
    throw err;
  });

  const refresh = async () => {
    try {
      srv.update(await rerun());
    } catch (err) {
      srv.fail(err instanceof Error ? err.message : String(err));
    }
  };

  if (watchMode && file) {
    // Watch the directory, not the file: editors that replace-on-save break a file watcher.
    const path = resolvePath(file);
    let timer: NodeJS.Timeout | undefined;
    watch(dirname(path), (_event, filename) => {
      if (filename && filename !== basename(path)) return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 100);
    });
  } else if (watchMode) {
    setInterval(() => void refresh(), MCP_WATCH_INTERVAL_MS).unref();
  }

  console.log(`mcp-charts preview: ${srv.url}`);
  console.log(`  source: ${source}${watchMode ? "  (watching)" : ""}`);
  console.log(`  Ctrl-C to stop`);
  if (values["no-open"] !== true) openBrowser(srv.url);

  // Keep the process alive on the server; resolve only on signal so Ctrl-C exits cleanly.
  await new Promise<void>((resolve) => {
    const stop = () => void srv.close().finally(resolve);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export async function main(argv: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        mcp: { type: "string" },
        tool: { type: "string" },
        args: { type: "string" },
        port: { type: "string" },
        theme: { type: "string" },
        watch: { type: "boolean" },
        "no-open": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err) {
    throw new CliError(`${err instanceof Error ? err.message : String(err)}. See mcp-charts --help.`);
  }
  const { values, positionals } = parsed;

  if (values.version) {
    console.log(packageVersion());
    return;
  }
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    if (!values.help && !command) process.exitCode = 1;
    return;
  }
  if (command !== "preview") {
    throw new CliError(`unknown command "${command}". See mcp-charts --help.`);
  }
  await preview(rest, values);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof CliError || err instanceof SpecLoadError || err instanceof McpClientError) {
    console.error(`mcp-charts: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
