// UAT / release gate: prove the render pipeline works end to end, without a browser.
//
// 1. Spawn the example MCP server on an alternate port and wait for /mcp.
// 2. Over stateless Streamable HTTP: tools/list -> explore_views -> render_view for EVERY view the
//    server exposes (discovered, not hardcoded).
// 3. Run each returned spec through the widget's SSR renderer and assert it produced real marks
//    (paths / rects / table rows), catching the "blank chart" failure family. Dashboards are
//    rendered per cell: renderToSvg takes a single ChartSpec, so each ChartCell's spec is rendered
//    and asserted, plus structural checks (>=1 cell, guardrail notes surfaced).
// 4. Run the widget test fixtures through resolve() + renderToSvg so inference regressions fail here.
// 5. Print a PASS/FAIL table and exit non-zero on any failure.
//
// Run with tsx (wired as `pnpm uat`) so the direct TS imports of the widget source resolve.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

import { resolve as resolveSpec, isDashboardSpec, isChartSpec } from "@bonnard/mcp-charts";
import { renderToSvg } from "../packages/widget/src/ssr.ts";
import { fixtures } from "../packages/widget/test/fixtures.ts";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.UAT_PORT ?? 3021);
const MCP_URL = `http://localhost:${PORT}/mcp`;

// --- assertions on a rendered spec ---------------------------------------------------------------

/** A rendered chart must contain actual marks; a table must contain rows. Empty or mark-less output
 *  is the "blank chart" failure this gate exists to catch. */
function assertHasMarks(chartType, svg, label) {
  if (!svg || svg.trim().length === 0) throw new Error(`${label}: empty render output`);
  const marks = chartType === "table" ? ["<tr"] : ["<path", "<rect", "<circle", "<polygon"];
  if (!marks.some((m) => svg.includes(m))) {
    throw new Error(`${label}: no marks (${marks.join("/")}) in ${svg.length}-char output`);
  }
}

/** Render + assert one spec (ChartSpec directly, DashboardSpec per cell). Returns a short detail. */
function renderAndAssert(spec, label) {
  if (isDashboardSpec(spec)) {
    const cells = spec.items.filter((it) => it && typeof it === "object" && "spec" in it);
    if (spec.items.length === 0) throw new Error(`${label}: dashboard has 0 items`);
    if (cells.length === 0) throw new Error(`${label}: dashboard has 0 chart cells`);
    for (const cell of cells) assertHasMarks(cell.spec.chartType, renderToSvg(cell.spec), `${label} cell`);
    // Surface guardrail notes (dashboard-level + per-cell) so a regression that starts noting shows here.
    const notes = [...(spec.notes ?? []), ...cells.flatMap((c) => c.spec.notes ?? [])];
    const kpis = spec.items.filter((it) => it && it.type === "kpi").length;
    return `dashboard: ${cells.length} cell(s), ${kpis} kpi(s)${notes.length ? `, notes: ${notes.length}` : ""}`;
  }
  if (isChartSpec(spec)) {
    assertHasMarks(spec.chartType, renderToSvg(spec), label);
    const notes = spec.notes?.length ? `, notes: ${spec.notes.length}` : "";
    return `chart: ${spec.chartType}, ${spec.data.length} row(s)${notes}`;
  }
  throw new Error(`${label}: result is neither a ChartSpec nor a DashboardSpec`);
}

// --- MCP over stateless Streamable HTTP ----------------------------------------------------------

let rpcId = 0;

/** POST one JSON-RPC call; parse either a JSON body or an SSE `data:` frame. */
async function rpc(method, params) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("data:"));
  const payload = JSON.parse(line ? line.slice("data:".length).trim() : text);
  if (payload.error) throw new Error(`${method} rpc error: ${payload.error.message}`);
  return payload.result;
}

async function initialize() {
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "uat", version: "1" },
  });
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      await initialize();
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`server never answered on ${MCP_URL}`);
}

// --- run ------------------------------------------------------------------------------------------

const results = []; // { name, ok, detail }
const record = (name, fn) => {
  try {
    results.push({ name, ok: true, detail: fn() });
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
};

async function main() {
  const server = spawn("pnpm", ["start"], {
    cwd: resolvePath(ROOT, "examples/dashboard"),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const stopServer = () => {
    try {
      server.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  };
  process.on("exit", stopServer);
  process.on("SIGINT", () => {
    stopServer();
    process.exit(130);
  });

  try {
    await waitForServer();

    const list = await rpc("tools/list", {});
    const toolNames = (list.tools ?? []).map((t) => t.name);
    record("tools/list", () => {
      for (const need of ["explore_views", "render_view"]) {
        if (!toolNames.includes(need)) throw new Error(`missing tool ${need}`);
      }
      return `tools: ${toolNames.join(", ")}`;
    });

    const explore = await rpc("tools/call", { name: "explore_views", arguments: {} });
    const views = explore.structuredContent?.views ?? [];
    record("explore_views", () => {
      if (views.length === 0) throw new Error("explore_views returned 0 views");
      return `${views.length} view(s): ${views.map((v) => v.id).join(", ")}`;
    });

    for (const view of views) {
      const label = `render_view:${view.id}`;
      let called;
      try {
        called = await rpc("tools/call", { name: "render_view", arguments: { view_id: view.id } });
      } catch (err) {
        results.push({ name: label, ok: false, detail: err instanceof Error ? err.message : String(err) });
        continue;
      }
      record(label, () => {
        if (called.isError) throw new Error(`tool error: ${called.content?.[0]?.text ?? "unknown"}`);
        const spec = called.structuredContent;
        if (!spec) throw new Error("no structuredContent on result");
        return renderAndAssert(spec, label);
      });
    }
  } finally {
    stopServer();
  }

  // Fixtures: resolve() + SSR, so inference regressions fail the gate too.
  for (const fx of fixtures) {
    record(`fixture:${fx.name}`, () => renderAndAssert(resolveSpec(fx.data, fx.opts), `fixture:${fx.name}`));
  }

  // --- report ---
  const pad = Math.max(...results.map((r) => r.name.length));
  console.log("\nUAT - render pipeline gate\n");
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(pad)}  ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed\n`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error("uat crashed:", err);
  process.exit(1);
});
