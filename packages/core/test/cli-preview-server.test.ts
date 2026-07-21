// The preview server + shell HTML: serves the embedded production widget, exposes the spec,
// announces updates over SSE, and re-runs the spec source on demand.
import { describe, it, expect } from "vitest";
import { startPreviewServer, type PreviewServer } from "../src/cli/preview-server.js";
import { renderShellHtml } from "../src/cli/shell-html.js";
import { WIDGET_HTML } from "../src/generated/widget-html.js";
import { chart } from "../src/views.js";
import type { PreviewSpec } from "../src/cli/load-spec.js";

const spec = chart(
  [
    { region: "EU", revenue: 100 },
    { region: "US", revenue: 200 },
  ],
  { chartType: "bar", title: "Revenue" },
);

const shell = renderShellHtml({ source: "/tmp/spec.json", mode: "file", theme: "light" });

async function withServer(
  opts: { rerun?: () => Promise<PreviewSpec> },
  fn: (srv: PreviewServer) => Promise<void>,
): Promise<void> {
  const srv = await startPreviewServer({ html: shell, initialPayload: spec, ...opts });
  try {
    await fn(srv);
  } finally {
    await srv.close();
  }
}

describe("shell HTML assembly", () => {
  it("wires the widget iframe at /widget#harness and speaks the harness protocol", () => {
    expect(shell).toContain('src="/widget#harness"');
    expect(shell).toContain("bonnard:harness-render");
    expect(shell).toContain("bonnard:harness-ready");
    expect(shell).toContain('data-theme="light"');
  });

  it("escapes the source label and hardens the config JSON", () => {
    const html = renderShellHtml({ source: `<script>alert(1)</script>`, mode: "mcp", theme: "dark" });
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;");
  });

  it("labels the re-run affordance by mode", () => {
    expect(shell).toContain("Reload file");
    expect(renderShellHtml({ source: "s", mode: "mcp", theme: "light" })).toContain("Re-run tool");
  });
});

describe("preview server (smoke, ephemeral port)", () => {
  it("serves the shell, the embedded production widget verbatim, and the spec", async () => {
    await withServer({}, async (srv) => {
      const page = await (await fetch(srv.url + "/")).text();
      expect(page).toBe(shell);

      const widgetRes = await fetch(srv.url + "/widget");
      expect(widgetRes.headers.get("content-type")).toContain("text/html");
      expect(await widgetRes.text()).toBe(WIDGET_HTML);

      const state = (await (await fetch(srv.url + "/spec")).json()) as any;
      expect(state.payload).toEqual(JSON.parse(JSON.stringify(spec)));
      expect(state.error).toBeNull();
    });
  });

  it("the embedded widget it serves still contains the #harness hook", () => {
    expect(WIDGET_HTML).toContain("#harness");
    expect(WIDGET_HTML).toContain("bonnard:harness-render");
    expect(WIDGET_HTML).toContain("bonnard:harness-ready");
  });

  it("update() bumps the version and pings SSE; identical payloads are a no-op", async () => {
    await withServer({}, async (srv) => {
      const events = await fetch(srv.url + "/events");
      const reader = events.body!.getReader();
      const readChunk = async () => new TextDecoder().decode((await reader.read()).value);
      expect(await readChunk()).toContain("retry:"); // SSE preamble

      const v0 = srv.state().version;
      srv.update(JSON.parse(JSON.stringify(spec)) as PreviewSpec); // structurally identical
      expect(srv.state().version).toBe(v0);

      const changed = { ...spec, title: "Changed" } as PreviewSpec;
      srv.update(changed);
      expect(srv.state().version).toBe(v0 + 1);
      expect(await readChunk()).toContain("event: render");
      await reader.cancel();
    });
  });

  it("POST /rerun invokes the source and updates the spec", async () => {
    let n = 0;
    const rerun = async () => ({ ...spec, title: `Run ${++n}` }) as PreviewSpec;
    await withServer({ rerun }, async (srv) => {
      const state = (await (await fetch(srv.url + "/rerun", { method: "POST" })).json()) as any;
      expect(state.payload.title).toBe("Run 1");
      expect(srv.state().payload).toMatchObject({ title: "Run 1" });
    });
  });

  it("a failing rerun surfaces the error but keeps the last good payload", async () => {
    const rerun = async () => {
      throw new Error("tool exploded");
    };
    await withServer({ rerun }, async (srv) => {
      const state = (await (await fetch(srv.url + "/rerun", { method: "POST" })).json()) as any;
      expect(state.error).toContain("tool exploded");
      expect(state.payload).toEqual(JSON.parse(JSON.stringify(spec)));
    });
  });

  it("unknown routes 404", async () => {
    await withServer({}, async (srv) => {
      expect((await fetch(srv.url + "/nope")).status).toBe(404);
    });
  });
});
