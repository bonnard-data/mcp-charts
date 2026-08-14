// Integration tests against the BUILT widget in a real browser. These are the tests that were
// missing when 0.3.0 shipped: the previous suite only exercised the fragment/token helpers, so no
// `main.ts` side effect (the `data-embed` attribute, the ready handshake, real layout, the size
// protocol) was ever covered.
//
// Everything here loads `dist/index.html` over http inside an opaque `sandbox="allow-scripts"`
// iframe, which is the posture the docs tell consumers to use.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser, Page } from "puppeteer-core";
import { resolve } from "@bonnard/mcp-charts";
import { CHART, KPI, TABLE, installDriver, launchBrowser, startServer, type Captured } from "./browser-helpers.js";

let browser: Browser;
let page: Page;
let baseUrl: string;
let stop: () => Promise<void>;

beforeAll(async () => {
  const server = await startServer();
  baseUrl = server.url;
  stop = server.close;
  browser = await launchBrowser();
  page = await browser.newPage();
  await page.setViewport({ width: 500, height: 600 });
  await page.goto(`${baseUrl}/parent.html`);
  await installDriver(page, baseUrl);
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await stop?.();
});

/** Mount a frame, wait for ready, and return the ready latency in ms (null if it never fired). */
async function mountAndWait(hash: string, opts?: { sandbox?: boolean; height?: number }): Promise<number | null> {
  await page.evaluate((h, o) => window.__mount(h, o), hash, opts ?? {});
  return page.evaluate(() => window.__waitReady());
}

const log = () => page.evaluate(() => window.__log);
const send = (message: unknown) => page.evaluate((m) => window.__send(m), message);
const state = () => page.evaluate(() => window.__frameState());
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

async function renderAndSettle(message: Record<string, unknown>, ms = 600): Promise<Captured[]> {
  const before = (await log()).length;
  await send({ type: "bonnard:render", ...message });
  await settle(ms);
  return (await log()).slice(before);
}

describe("embed mode: the ready handshake", () => {
  it("posts bonnard:ready promptly in an opaque sandboxed iframe", async () => {
    const latency = await mountAndWait("#embed");
    expect(latency).not.toBeNull();
    // The regression this guards: ready used to be sequenced behind an MCP handshake that an
    // ordinary embedding parent never answers. A generous ceiling still catches that.
    expect(latency!).toBeLessThan(1000);
  });

  it("carries the protocol version", async () => {
    await mountAndWait("#embed");
    const ready = (await log()).find((m) => m.type === "bonnard:ready");
    expect(ready?.data.protocolVersion).toBe(1);
  });

  it("never starts the MCP Apps transport in embed mode", async () => {
    await mountAndWait("#embed");
    await settle(800);
    // `ui/initialize` would show up as an rpc:* message. Its absence is the fix for the competing
    // bridge: no second size protocol, and nothing to wait on.
    expect((await log()).filter((m) => m.type.startsWith("rpc:"))).toEqual([]);
  });

  it("renders a payload posted before ready was observed", async () => {
    // Post immediately after mount, racing the frame's own ready. Either the frame gets it, or the
    // parent re-feeds on ready; both must end with the KPI drawn, never a stuck waiting state.
    await page.evaluate((h) => window.__mount(h, { sandbox: false }), "#embed");
    await send({ type: "bonnard:render", payload: KPI });
    const latency = await page.evaluate(() => window.__waitReady());
    expect(latency).not.toBeNull();
    await send({ type: "bonnard:render", payload: KPI });
    await settle();
    expect((await state()).rootHTML).toContain("Revenue");
  });
});

describe("embed mode: the CSS activates", () => {
  it("sets data-embed and drops body padding to 0", async () => {
    await mountAndWait("#embed", { sandbox: false });
    const s = await state();
    expect(s.dataEmbed).toBe("");
    expect(s.bodyPadding).toBe("0px");
  });

  it("leaves both untouched without the fragment", async () => {
    await page.evaluate((h) => window.__mount(h, { sandbox: false }), "");
    await settle(600);
    const s = await state();
    expect(s.dataEmbed).toBeNull();
    expect(s.bodyPadding).toBe("12px");
  });
});

describe("embed mode: sender authentication", () => {
  it("ignores a render posted by a window that is not the parent", async () => {
    await mountAndWait("#embed", { sandbox: false });
    const injected = await page.evaluate(async () => {
      const frame = document.querySelector("#box iframe") as HTMLIFrameElement;
      // A sibling frame that holds the target's WindowProxy and posts to it directly.
      const foreign = document.createElement("iframe");
      foreign.srcdoc =
        "<script>window.addEventListener('message',function(){" +
        "parent.frames[0].postMessage({type:'bonnard:render',payload:{type:'text',text:'INJECTED'}},'*');});</scr" +
        "ipt>";
      document.body.appendChild(foreign);
      await new Promise((r) => (foreign.onload = r));
      foreign.contentWindow!.postMessage("go", "*");
      await new Promise((r) => setTimeout(r, 500));
      const html = frame.contentDocument!.getElementById("root")!.innerHTML;
      foreign.remove();
      return html;
    });
    expect(injected).not.toContain("INJECTED");
  });
});

describe("embed mode: fill versus content sizing", () => {
  it("a fill chart reports no content height, only the fill release", async () => {
    // Sandboxed (opaque origin): the message behaviour is what a real consumer sees.
    await mountAndWait("#embed");
    const msgs = await renderAndSettle({ payload: CHART }, 900);
    const sizes = msgs.filter((m) => m.type === "bonnard:size");
    // No measured height is ever reported for a fill payload, so there is nothing to feed back.
    expect(sizes.filter((m) => m.data.sizing === "content")).toEqual([]);
    // Exactly one release, telling the parent to let go of any height it had applied.
    expect(sizes.filter((m) => m.data.sizing === "fill")).toHaveLength(1);
    expect(sizes.every((m) => m.data.height === null)).toBe(true);
  });

  it("marks a fill chart as fill in the DOM", async () => {
    await mountAndWait("#embed", { sandbox: false });
    await renderAndSettle({ payload: CHART }, 900);
    expect((await state()).dataSizing).toBe("fill");
  });

  it("a KPI reports a content height", async () => {
    await mountAndWait("#embed");
    const msgs = await renderAndSettle({ payload: KPI });
    const sizes = msgs.filter((m) => m.type === "bonnard:size");
    expect(sizes.length).toBeGreaterThanOrEqual(1);
    expect(sizes[0]!.data.sizing).toBe("content");
    expect(sizes[0]!.data.height).toBeGreaterThan(0);
  });

  it("a table reports a content height", async () => {
    await mountAndWait("#embed");
    const msgs = await renderAndSettle({ payload: TABLE });
    expect(msgs.filter((m) => m.type === "bonnard:size").length).toBeGreaterThanOrEqual(1);
  });

  it("marks content cells as content in the DOM", async () => {
    for (const payload of [KPI, TABLE]) {
      await mountAndWait("#embed", { sandbox: false });
      await renderAndSettle({ payload });
      expect((await state()).dataSizing).toBe("content");
    }
  });

  // The loop-safety property: the parent writes every reported height straight back onto the
  // iframe, which is the feedback topology that oscillates when html/body are pinned to the
  // viewport. The count must stabilise within a bounded number of frames.
  const convergenceCases: Array<[string, unknown]> = [
    ["kpi", KPI],
    ["wrapped text", { type: "text", heading: "Q2", text: "Revenue grew across every region. ".repeat(12) }],
    [
      "table long enough to scroll",
      {
        chartType: "table",
        columns: [{ key: "region" }, { key: "revenue" }],
        data: Array.from({ length: 25 }, (_, i) => ({ region: `Region ${i}`, revenue: i * 1000 })),
      },
    ],
    ["fractional content", { type: "text", text: "x".repeat(37) }],
  ];

  for (const [label, payload] of convergenceCases) {
    it(`converges when the parent applies every reported height: ${label}`, async () => {
      await mountAndWait("#embed");
      await page.evaluate(() => window.__applyHeights("correct"));
      const msgs = await renderAndSettle({ payload }, 2000);
      await page.evaluate(() => window.__applyHeights(false));
      const sizes = msgs.filter((m) => m.type === "bonnard:size" && m.data.sizing === "content");
      // A few reports are legitimate (first paint, then a font/wrap settle). An oscillation would
      // keep posting for the whole window, so a small bound is the real assertion.
      expect(sizes.length).toBeGreaterThanOrEqual(1);
      expect(sizes.length).toBeLessThanOrEqual(4);
      // And it must have gone quiet: nothing in the last stretch of the window.
      const last = sizes[sizes.length - 1]!;
      const end = msgs.length ? msgs[msgs.length - 1]!.t : last.t;
      expect(end - last.t).toBeGreaterThanOrEqual(0);
    });
  }
});

describe("embed mode: a fill chart never leaves the frame collapsed", () => {
  // The 0.3.1 trap. The pre-render waiting state is content-shaped, so it used to report ~48px; a
  // parent applying that shrank the frame, and the fill chart then filled 48px permanently, with no
  // message ever telling the parent to let go. Both halves are asserted here.

  it("the waiting state alone drives no height change", async () => {
    await page.evaluate(() => window.__applyHeights("naive"));
    await mountAndWait("#embed", { height: 300 });
    await settle(900);
    const box = await page.evaluate(() => window.__frameBox());
    await page.evaluate(() => window.__applyHeights(false));
    // Nothing was applied, so no inline height exists and the frame is still the container's height.
    expect(box.styleHeight).toBe("");
    expect(box.height).toBe(300);
    // And no content size was reported for the placeholder.
    const sizes = (await log()).filter((m) => m.type === "bonnard:size");
    expect(sizes).toEqual([]);
  });

  it("a fill chart keeps the parent's height even under the naive handler", async () => {
    // `naive` is the handler 0.3.0's docs showed: apply `height` unconditionally. With a null height
    // on the fill message it must not produce a usable pixel value, so the frame keeps its own size.
    await page.evaluate(() => window.__applyHeights("naive"));
    await mountAndWait("#embed", { height: 300 });
    await renderAndSettle({ payload: CHART }, 1500);
    const box = await page.evaluate(() => window.__frameBox());
    await page.evaluate(() => window.__applyHeights(false));
    expect(box.height).toBe(300);
  });

  it("a fill chart releases a height applied for a previous content payload", async () => {
    await page.evaluate(() => window.__applyHeights("correct"));
    await mountAndWait("#embed", { height: 300 });
    // A KPI first: the parent legitimately shrinks the frame to the content height.
    await renderAndSettle({ payload: KPI }, 1200);
    const shrunk = await page.evaluate(() => window.__frameBox());
    expect(shrunk.height).toBeLessThan(120);
    // Then a chart. The widget must announce fill so the parent can restore its own height.
    const msgs = await renderAndSettle({ payload: CHART }, 1500);
    const box = await page.evaluate(() => window.__frameBox());
    await page.evaluate(() => window.__applyHeights(false));
    const release = msgs.find((m) => m.type === "bonnard:size" && m.data.sizing === "fill");
    expect(release, "expected a sizing:fill release message").toBeTruthy();
    expect(release!.data.height).toBeNull();
    expect(box.height).toBe(300);
  });

  it("the released frame holds a full-height chart, not a squashed one", async () => {
    await page.evaluate(() => window.__applyHeights("correct"));
    await mountAndWait("#embed", { sandbox: false, height: 300 });
    await renderAndSettle({ payload: KPI }, 1200);
    await renderAndSettle({ payload: CHART }, 1500);
    const measured = await page.evaluate(() => {
      const f = document.querySelector("#box iframe") as HTMLIFrameElement;
      const svg = f.contentDocument!.querySelector("svg");
      return {
        frameHeight: Math.round(f.getBoundingClientRect().height),
        svgHeight: svg ? Math.round(svg.getBoundingClientRect().height) : null,
      };
    });
    await page.evaluate(() => window.__applyHeights(false));
    expect(measured.frameHeight).toBe(300);
    // The chart fills the restored frame rather than overflowing a collapsed one.
    expect(measured.svgHeight).toBeGreaterThan(250);
    expect(measured.svgHeight!).toBeLessThanOrEqual(measured.frameHeight + 4);
  });

  it("switching back to a content payload resumes reporting", async () => {
    await page.evaluate(() => window.__applyHeights("correct"));
    await mountAndWait("#embed", { height: 300 });
    await renderAndSettle({ payload: CHART }, 1200);
    const msgs = await renderAndSettle({ payload: KPI }, 1200);
    const box = await page.evaluate(() => window.__frameBox());
    await page.evaluate(() => window.__applyHeights(false));
    const content = msgs.filter((m) => m.type === "bonnard:size" && m.data.sizing === "content");
    expect(content.length).toBeGreaterThanOrEqual(1);
    expect(box.height).toBeLessThan(120);
  });

  it("sends the fill release only once per episode", async () => {
    await mountAndWait("#embed", { height: 300 });
    const first = await renderAndSettle({ payload: CHART }, 1200);
    expect(first.filter((m) => m.type === "bonnard:size" && m.data.sizing === "fill")).toHaveLength(1);
    // A second fill render is still the same fill episode: no repeat release.
    const second = await renderAndSettle({ payload: CHART }, 1200);
    expect(second.filter((m) => m.type === "bonnard:size" && m.data.sizing === "fill")).toHaveLength(0);
  });

  it("a failed render returns to the placeholder without reporting a height", async () => {
    await page.evaluate(() => window.__applyHeights("naive"));
    await mountAndWait("#embed", { height: 300 });
    await renderAndSettle({ payload: CHART }, 1200);
    // An invalid payload is refused before render, so the chart stays and no height is reported.
    const msgs = await renderAndSettle({ payload: { type: "text" }, renderId: "bad" }, 900);
    const box = await page.evaluate(() => window.__frameBox());
    await page.evaluate(() => window.__applyHeights(false));
    expect(msgs.find((m) => m.type === "bonnard:error")).toBeTruthy();
    expect(msgs.filter((m) => m.type === "bonnard:size" && m.data.sizing === "content")).toEqual([]);
    expect(box.height).toBe(300);
  });
});

describe("embed mode: payload validation", () => {
  const malformed: Array<[string, unknown]> = [
    ["items:[null]", { items: [null] }],
    ["bare type:text", { type: "text" }],
    ["data:[{}] with no series", { data: [{}] }],
    ["null", null],
    ["a string", "dark"],
    ["an array", [1, 2, 3]],
    ["kpi with no label", { type: "kpi", value: 1 }],
    ["chart with non-string x", { chartType: "bar", data: [{ a: 1 }], x: 5, series: [{ key: "a" }] }],
  ];

  for (const [label, payload] of malformed) {
    it(`returns a typed error and stays intact: ${label}`, async () => {
      await mountAndWait("#embed", { sandbox: false });
      // Draw something valid first, so a partial-state bug would be visible as a wipe.
      await renderAndSettle({ payload: KPI });
      const before = await state();
      const msgs = await renderAndSettle({ payload, renderId: label });
      const err = msgs.find((m) => m.type === "bonnard:error");
      expect(err, `expected bonnard:error for ${label}`).toBeTruthy();
      expect(err!.data.renderId).toBe(label);
      expect(typeof err!.data.code).toBe("string");
      // The previous good render is untouched: no half-torn-down DOM.
      expect((await state()).rootHTML).toBe(before.rootHTML);
    });
  }

  it("refuses an oversized payload rather than stalling", async () => {
    await mountAndWait("#embed");
    const msgs = await renderAndSettle(
      {
        payload: {
          chartType: "bar",
          x: "i",
          series: [{ key: "v" }],
          data: Array.from({ length: 25_000 }, (_, i) => ({ i, v: i })),
        },
        renderId: "big",
      },
      1500,
    );
    const err = msgs.find((m) => m.type === "bonnard:error");
    expect(err?.data.code).toBe("payload-too-large");
  });

  it("refuses a string bomb", async () => {
    await mountAndWait("#embed");
    const msgs = await renderAndSettle({ payload: { type: "text", text: "x".repeat(20_000) }, renderId: "bomb" }, 1000);
    expect(msgs.find((m) => m.type === "bonnard:error")?.data.code).toBe("payload-too-large");
  });
});

describe("embed mode: item selection fails closed", () => {
  const dashboard = {
    title: "Dash",
    items: [
      { id: "txt", type: "text", text: "first" },
      { id: "rev", spec: CHART },
    ],
  };

  const badSelectors: Array<[string, Record<string, unknown>, string]> = [
    ["negative index", { item: -1 }, "item-not-found"],
    ["out of range index", { item: 99 }, "item-not-found"],
    ["non-integer index", { item: 1.5 }, "invalid-item-selector"],
    ["wrong-typed index", { item: "1" }, "invalid-item-selector"],
    ["unknown itemId", { itemId: "nope" }, "item-not-found"],
    ["empty itemId", { itemId: "" }, "invalid-item-selector"],
  ];

  for (const [label, selector, code] of badSelectors) {
    it(`${label} errors instead of leaking the whole grid`, async () => {
      await mountAndWait("#embed", { sandbox: false });
      const msgs = await renderAndSettle({ payload: dashboard, ...selector, renderId: label });
      expect(msgs.find((m) => m.type === "bonnard:error")?.data.code).toBe(code);
      // The decisive part: no grid was drawn.
      expect((await state()).rootHTML).not.toContain('class="grid"');
    });
  }

  it("selects by numeric index", async () => {
    await mountAndWait("#embed", { sandbox: false });
    await renderAndSettle({ payload: dashboard, item: 0 });
    const s = await state();
    expect(s.rootHTML).toContain("first");
    expect(s.rootHTML).not.toContain("grid");
  });

  it("selects by itemId", async () => {
    await mountAndWait("#embed", { sandbox: false });
    await renderAndSettle({ payload: dashboard, itemId: "rev" }, 900);
    const s = await state();
    expect(s.hasSvg).toBe(true);
    expect(s.rootHTML).not.toContain("first");
  });

  it("renders the whole grid when nothing is selected", async () => {
    await mountAndWait("#embed", { sandbox: false });
    await renderAndSettle({ payload: dashboard }, 900);
    expect((await state()).rootHTML).toContain("grid");
  });

  it("rejects a selector against a non-dashboard payload", async () => {
    await mountAndWait("#embed");
    const msgs = await renderAndSettle({ payload: CHART, item: 0, renderId: "sel" });
    expect(msgs.find((m) => m.type === "bonnard:error")?.data.code).toBe("invalid-item-selector");
  });
});

describe("embed mode: theme precedence", () => {
  it("uses the fragment theme initially", async () => {
    await mountAndWait("#embed&theme=dark", { sandbox: false });
    expect((await state()).dataTheme).toBe("dark");
  });

  it("a render message theme overrides the fragment and persists", async () => {
    await mountAndWait("#embed&theme=dark", { sandbox: false });
    await renderAndSettle({ payload: KPI, theme: "light" });
    expect((await state()).dataTheme).toBe("light");
    // A host/OS refresh must not revert the explicit override.
    await page.evaluate(() => {
      const f = document.querySelector("#box iframe") as HTMLIFrameElement;
      f.contentDocument!.dispatchEvent(
        new (f.contentWindow as unknown as Window & { CustomEvent: typeof CustomEvent }).CustomEvent(
          "openai:set_globals",
          { detail: { globals: { theme: "dark" } } },
        ),
      );
    });
    await settle(300);
    expect((await state()).dataTheme).toBe("light");
  });

  it("falls back to light with no fragment theme and no host", async () => {
    await mountAndWait("#embed", { sandbox: false });
    expect((await state()).dataTheme).toBe("light");
  });
});

describe("embed mode: token validation in the real CSSOM", () => {
  it("applies valid colour and font tokens", async () => {
    await mountAndWait("#embed", { sandbox: false });
    await renderAndSettle({
      payload: KPI,
      tokens: {
        bg: "#fffdf7",
        fg: "rgb(28 25 23)",
        muted: "oklch(0.6 0.02 250)",
        border: "#e7e5e4",
        fontFamily: '"Helvetica Neue", Arial',
      },
    });
    const t = (await state()).tokens as Record<string, string>;
    expect(t.bg).toBe("#fffdf7");
    expect(t.fg).toBe("rgb(28 25 23)");
    expect(t.muted).toBe("oklch(0.6 0.02 250)");
    expect(t.fontFamily).toBe('"Helvetica Neue", Arial');
  });

  const attacks: Array<[string, string]> = [
    ["escaped url()", "u\\72l(https://attacker.example/pixel)"],
    ["literal url()", "url(https://attacker.example/pixel)"],
    ["image-set()", "image-set('https://attacker.example/x.png')"],
    ["var() indirection", "var(--fg)"],
    ["declaration break", "red; background: url(x)"],
    ["rule break", "red} body {color:blue"],
    ["expression()", "expression(alert(1))"],
    ["@import", "@import 'x'"],
    ["comment", "rgb(0,0,0)/*c*/"],
    ["newline", "red\nbackground:url(x)"],
    ["unicode escape", "\\75 rl(x)"],
    ["gradient", "linear-gradient(red,blue)"],
  ];

  for (const [label, value] of attacks) {
    it(`drops a hostile bg token and loads nothing: ${label}`, async () => {
      await mountAndWait("#embed", { sandbox: false });
      await renderAndSettle({ payload: KPI, tokens: { bg: value, fg: "#00ff00" } });
      const s = await state();
      expect((s.tokens as Record<string, string>).bg, label).toBe("");
      // The load-bearing assertion: the page never resolves a background image.
      expect(s.bodyBackgroundImage).toBe("none");
      // A dropped token must not take the valid ones with it.
      expect((s.tokens as Record<string, string>).fg).toBe("#00ff00");
    });
  }

  it("drops a hostile fontFamily", async () => {
    await mountAndWait("#embed", { sandbox: false });
    await renderAndSettle({ payload: KPI, tokens: { fontFamily: "u\\72l(x)" } });
    expect(((await state()).tokens as Record<string, string>).fontFamily).toBe("");
  });

  it("ignores the retired grid token", async () => {
    await mountAndWait("#embed", { sandbox: false });
    await renderAndSettle({ payload: KPI, tokens: { grid: "#eeeeee", fg: "#123456" } as never });
    const t = (await state()).tokens as Record<string, string>;
    expect(t.fg).toBe("#123456");
  });
});

describe("embed mode: titled applies to every single-cell shape", () => {
  it("titled=true draws a chart title", async () => {
    await mountAndWait("#embed&titled=true", { sandbox: false });
    await renderAndSettle({ payload: CHART }, 900);
    expect((await state()).titleText).toBe("Revenue by region");
  });

  it("titled=true draws a table title", async () => {
    await mountAndWait("#embed&titled=true", { sandbox: false });
    await renderAndSettle({ payload: TABLE });
    expect((await state()).titleText).toBe("Revenue table");
  });

  it("titled=true draws the title of a cell selected from a dashboard", async () => {
    await mountAndWait("#embed&titled=true", { sandbox: false });
    await renderAndSettle({ payload: { title: "Dash", items: [{ id: "rev", spec: CHART }] }, itemId: "rev" }, 900);
    expect((await state()).titleText).toBe("Revenue by region");
  });

  it("titled=true draws the title of a bare chart cell", async () => {
    await mountAndWait("#embed&titled=true", { sandbox: false });
    await renderAndSettle({ payload: { type: "chart", spec: CHART } }, 900);
    expect((await state()).titleText).toBe("Revenue by region");
  });

  it("the default draws no title on any of them", async () => {
    for (const payload of [CHART, TABLE, { type: "chart", spec: CHART }]) {
      await mountAndWait("#embed", { sandbox: false });
      await renderAndSettle({ payload }, 800);
      expect((await state()).titleText).toBeNull();
    }
  });
});

describe("embed mode: a real chart renders", () => {
  it("mounts an SVG that fills the container", async () => {
    await mountAndWait("#embed", { sandbox: false, height: 300 });
    await renderAndSettle({ payload: CHART }, 1200);
    const measured = await page.evaluate(() => {
      const f = document.querySelector("#box iframe") as HTMLIFrameElement;
      const svg = f.contentDocument!.querySelector("svg")!;
      return { svgHeight: Math.round(svg.getBoundingClientRect().height), frameHeight: f.clientHeight };
    });
    expect(measured.svgHeight).toBeGreaterThan(200);
    // Fill mode: the chart takes the container height, not a fixed 340px.
    expect(Math.abs(measured.svgHeight - measured.frameHeight)).toBeLessThanOrEqual(4);
  });
});

describe("the harness dialect stays separate and unchanged", () => {
  it("#harness ignores the public bonnard:render dialect", async () => {
    await page.evaluate((h) => window.__mount(h, { sandbox: false }), "#harness");
    await settle(600);
    await send({ type: "bonnard:render", payload: CHART });
    await settle(600);
    const s = await state();
    expect(s.hasSvg).toBe(false);
    expect(s.rootHTML).toContain("Waiting for chart data");
  });

  it("#harness still renders its own dialect, with its title and chart", async () => {
    await page.evaluate((h) => window.__mount(h, { sandbox: false }), "#harness");
    await settle(600);
    await send({ type: "bonnard:harness-render", structuredContent: CHART });
    await settle(900);
    const s = await state();
    expect(s.hasSvg).toBe(true);
    expect(s.titleText).toBe("Revenue by region");
    // Host-surface posture is retained: no embed attribute, full padding.
    expect(s.dataEmbed).toBeNull();
    expect(s.bodyPadding).toBe("12px");
  });

  it("#harness emits no embed protocol messages", async () => {
    await page.evaluate((h) => window.__mount(h, { sandbox: false }), "#harness");
    await settle(700);
    const msgs = await log();
    expect(msgs.filter((m) => m.type.startsWith("bonnard:size"))).toEqual([]);
    expect(msgs.filter((m) => m.type === "bonnard:ready")).toEqual([]);
    expect(msgs.some((m) => m.type === "bonnard:harness-ready")).toBe(true);
  });

  it("#embed rejects the harness dialect", async () => {
    await mountAndWait("#embed", { sandbox: false });
    await send({ type: "bonnard:harness-render", structuredContent: CHART });
    await settle(700);
    const s = await state();
    expect(s.hasSvg).toBe(false);
    expect(s.rootHTML).toContain("Waiting for chart data");
  });
});

describe("no fragment: the MCP host path is untouched", () => {
  it("emits no embed messages and ignores embed renders", async () => {
    await page.evaluate((h) => window.__mount(h, { sandbox: false }), "");
    await settle(800);
    await send({ type: "bonnard:render", payload: CHART });
    await settle(600);
    const msgs = await log();
    expect(msgs.filter((m) => m.type === "bonnard:ready")).toEqual([]);
    expect(msgs.filter((m) => m.type === "bonnard:size")).toEqual([]);
    expect((await state()).hasSvg).toBe(false);
  });

  it("still starts the MCP Apps transport (ui/initialize is posted)", async () => {
    await page.evaluate((h) => window.__mount(h, { sandbox: false }), "");
    await settle(1200);
    const msgs = await log();
    expect(msgs.some((m) => m.type === "rpc:ui/initialize")).toBe(true);
  });
});

describe("decision audiences in the built widget", () => {
  // A genuine advisory, produced by core rather than hand-written: 40 categories over the 30-bar
  // cap gives a viewer caption, and a typo'd encode column gives an author-only one.
  const capped = resolve(
    {
      rows: Array.from({ length: 40 }, (_, i) => ({ region: `region ${i}`, revenue: i + 1 })),
      fields: [
        { name: "region", role: "dimension", kind: "string" },
        { name: "revenue", role: "measure", kind: "number" },
      ],
      encode: { y: "revenue", size: "revenu" },
    },
    { chartType: "bar" },
  );

  it("captions the viewer decision and holds back the author one by default", async () => {
    expect(capped.decisions?.map((d) => d.kind)).toEqual(["encode_unknown_column", "bar_cap"]);
    await mountAndWait("#embed", { sandbox: false });
    await renderAndSettle({ payload: capped });
    const html = (await state()).rootHTML;
    expect(html).toContain("Showing the top 30 of 40 categories by value.");
    expect(html).not.toContain("Ignored unknown encode column");
  });

  it("audiences=all captions every decision", async () => {
    await mountAndWait("#embed&audiences=all", { sandbox: false });
    await renderAndSettle({ payload: capped });
    const html = (await state()).rootHTML;
    expect(html).toContain("Showing the top 30 of 40 categories by value.");
    expect(html).toContain("Ignored unknown encode column");
  });

  it("audiences=none drops the captions but never the cell's error", async () => {
    await mountAndWait("#embed&audiences=none", { sandbox: false });
    await renderAndSettle({ payload: { spec: capped, error: "Query timed out" } });
    const html = (await state()).rootHTML;
    expect(html).not.toContain("Showing the top 30");
    expect(html).toContain('<div class="cell-error">Query timed out</div>');
  });
});
