// Embed mode: fragment parsing, token validation, the size-report protocol, and the chrome-less
// single-cell markup. Structural (linkedom) in the same style as dashboard.test.ts. The behavioural
// checks that need real layout and a real origin (ready timing, `data-embed`, fill/content sizing,
// source filtering) live in embed-browser.test.ts, against the built widget.
import { describe, it, expect, vi } from "vitest";
import { parseHTML } from "linkedom";
import { dashboardFixtures } from "@bonnard/mcp-charts/fixtures";
import type { ChartSpec, DashboardItem, DashboardSpec } from "@bonnard/mcp-charts";
import {
  renderSingleItem,
  renderDashboardShell,
  isDashboardItem,
  isChartSpec,
  isDashboardSpec,
} from "../src/dashboard.js";
import { EMBED_PROTOCOL_VERSION, SizeReporter, applyTokens, parseEmbedFragment, sanitizeTokens } from "../src/embed.js";
import { EMBED_LIMITS, selectItem, validatePayload } from "../src/embed-protocol.js";
import { embedFixtures } from "./embed-fixtures.js";

const spec = (name: string): DashboardSpec => dashboardFixtures.find((f) => f.name === name)!.spec;
const doc = (html: string): Document => parseHTML(`<div>${html}</div>`).document as unknown as Document;

const kpi: DashboardItem = {
  type: "kpi",
  label: "Revenue",
  value: 128400,
  format: "currency",
  currency: "USD",
  delta: 0.12,
};
const chartSpec: ChartSpec = {
  chartType: "bar",
  title: "Revenue by region",
  data: [{ region: "EMEA", revenue: 10 }],
  x: "region",
  series: [{ key: "revenue", label: "Revenue" }],
  legend: false,
  notes: ["Coerced revenue to numbers."],
};

describe("parseEmbedFragment", () => {
  it("returns null for the host path and the dev harness (embed stays inert)", () => {
    expect(parseEmbedFragment("")).toBeNull();
    expect(parseEmbedFragment("#")).toBeNull();
    expect(parseEmbedFragment("#harness")).toBeNull();
    expect(parseEmbedFragment("#embedded")).toBeNull();
    expect(parseEmbedFragment("#not-embed")).toBeNull();
  });

  it("bare #embed: untitled, viewer captions only, no theme override", () => {
    expect(parseEmbedFragment("#embed")).toEqual({ titled: false, theme: undefined, audiences: ["viewer"] });
  });

  it("parses flags after #embed", () => {
    expect(parseEmbedFragment("#embed&titled=true&theme=dark&audiences=none")).toEqual({
      titled: true,
      theme: "dark",
      audiences: [],
    });
  });

  it("parses the audience list, `all`, and `none`", () => {
    const audiences = (hash: string) => parseEmbedFragment(hash)?.audiences;
    expect(audiences("#embed&audiences=viewer,author")).toEqual(["viewer", "author"]);
    expect(audiences("#embed&audiences=agent")).toEqual(["agent"]);
    expect(audiences("#embed&audiences=all")).toEqual(["viewer", "author", "agent"]);
    expect(audiences("#embed&audiences=none")).toEqual([]);
    // An unrecognized value keeps the default rather than silently blanking every caption.
    expect(audiences("#embed&audiences=nobody")).toEqual(["viewer"]);
  });

  it("keeps the deprecated notes flag working: false hides captions, true is the viewer default", () => {
    const audiences = (hash: string) => parseEmbedFragment(hash)?.audiences;
    expect(audiences("#embed&notes=false")).toEqual([]);
    expect(audiences("#embed&notes=true")).toEqual(["viewer"]);
    expect(audiences("#embed&notes")).toEqual(["viewer"]);
    // audiences wins when both are given.
    expect(audiences("#embed&notes=false&audiences=all")).toEqual(["viewer", "author", "agent"]);
  });

  it("bare and 1/true flag spellings all read as on", () => {
    for (const hash of ["#embed&titled", "#embed&titled=", "#embed&titled=1", "#embed&titled=true"]) {
      expect(parseEmbedFragment(hash)?.titled).toBe(true);
    }
    expect(parseEmbedFragment("#embed&titled=false")?.titled).toBe(false);
    expect(parseEmbedFragment("#embed&titled=no")?.titled).toBe(false);
  });

  it("ignores an unknown theme and unknown flags (forward compatibility)", () => {
    expect(parseEmbedFragment("#embed&theme=neon&kiosk=2")).toEqual({
      titled: false,
      theme: undefined,
      audiences: ["viewer"],
    });
  });

  it("accepts #embed? as well as #embed&", () => {
    expect(parseEmbedFragment("#embed?theme=dark")?.theme).toBe("dark");
  });
});

describe("sanitizeTokens", () => {
  it("keeps the allowed keys", () => {
    expect(
      sanitizeTokens({
        bg: "#fff",
        fg: "rgb(10 10 10)",
        muted: "#6b7280",
        border: "#eee",
        fontFamily: "Inter, system-ui, sans-serif",
      }),
    ).toEqual({
      bg: "#fff",
      fg: "rgb(10 10 10)",
      muted: "#6b7280",
      border: "#eee",
      fontFamily: "Inter, system-ui, sans-serif",
    });
  });

  it("drops unknown keys, including the retired `grid` token", () => {
    expect(sanitizeTokens({ bg: "#fff", grid: "#eee", accent: "#f00", palette: ["#f00"], radius: "8px" })).toEqual({
      bg: "#fff",
    });
  });

  it("accepts the colour grammar: hex, keywords, and numeric colour functions", () => {
    for (const bg of [
      "#fff",
      "#ffff",
      "#ffffff",
      "#ffffffaa",
      "red",
      "transparent",
      "currentcolor",
      "rgb(1 2 3)",
      "rgb(1,2,3)",
      "rgba(1,2,3,0.5)",
      "rgb(1 2 3 / 50%)",
      "hsl(210 40% 98%)",
      "oklch(0.7 0.1 200)",
      "lab(50% 40 59.5)",
    ]) {
      expect(sanitizeTokens({ bg }), bg).toEqual({ bg });
    }
  });

  // The 0.3.0 bypass: the denylist only rejected a literal `url(`, but CSS function names allow
  // escapes, so `u\72l(...)` tokenized as `url()` and reached the network through `background`.
  it("rejects every URL-bearing and escape-based form", () => {
    for (const bg of [
      "u\\72l(https://attacker.example/pixel)",
      "\\75rl(x)",
      "url(https://attacker.example/x.png)",
      "URL(x)",
      "image-set('https://attacker.example/x.png')",
      "-webkit-image-set(url(x) 1x)",
      "linear-gradient(red, blue)",
      "var(--fg)",
      "attr(data-x)",
      "element(#foo)",
    ]) {
      expect(sanitizeTokens({ bg }), bg).toEqual({});
    }
  });

  it("rejects structural, comment, control, and over-long values", () => {
    for (const bg of [
      "red; background: url(x)",
      "red} body {color:blue",
      "expression(alert(1))",
      "@import 'x'",
      "rgb(0,0,0)/*c*/",
      "/*x*/red",
      "red\nbackground:url(x)",
      "red\tblue",
      "red\u0000",
      "#" + "f".repeat(200),
      "rgb(1 2)",
      "rgb(1 2 3 4 5)",
      "notacolour",
      "rgb(var(--x))",
    ]) {
      expect(sanitizeTokens({ bg }), bg).toEqual({});
    }
  });

  it("drops non-strings and blanks", () => {
    expect(sanitizeTokens({ bg: 123 })).toEqual({});
    expect(sanitizeTokens({ bg: "   " })).toEqual({});
  });

  it("accepts a conservative fontFamily grammar and rejects the rest", () => {
    for (const fontFamily of ["Inter", "Inter, system-ui, sans-serif", '"Helvetica Neue", Arial', "Segoe UI"]) {
      expect(sanitizeTokens({ fontFamily }), fontFamily).toEqual({ fontFamily });
    }
    for (const fontFamily of [
      "u\\72l(x)",
      "Inter;color:red",
      "local('x')",
      "Inter\n,serif",
      "Inter, ",
      "@font-face",
      'Inter"x',
    ]) {
      expect(sanitizeTokens({ fontFamily }), fontFamily).toEqual({});
    }
  });

  it("a rejected token does not discard the valid ones alongside it", () => {
    expect(sanitizeTokens({ bg: "url(x)", fg: "#fafafa" })).toEqual({ fg: "#fafafa" });
  });

  it("tolerates a non-object payload", () => {
    expect(sanitizeTokens(undefined)).toEqual({});
    expect(sanitizeTokens("dark")).toEqual({});
    expect(sanitizeTokens(null)).toEqual({});
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeTokens({ bg: "  #fff  " })).toEqual({ bg: "#fff" });
  });
});

describe("applyTokens", () => {
  const rootEl = () => {
    const { document } = parseHTML("<html><body></body></html>");
    return document.documentElement as unknown as HTMLElement;
  };

  it("maps tokens onto CSS custom properties (never raw CSS text)", () => {
    const el = rootEl();
    applyTokens(el, sanitizeTokens({ bg: "#101010", fg: "#fafafa", fontFamily: "Inter" }));
    expect(el.style.getPropertyValue("--bg")).toBe("#101010");
    expect(el.style.getPropertyValue("--fg")).toBe("#fafafa");
    // A custom property, matching the documented "tokens are set as CSS custom properties" claim.
    expect(el.style.getPropertyValue("--font-family")).toBe("Inter");
  });

  it("clears previously-set tokens when a later render omits them", () => {
    const el = rootEl();
    applyTokens(el, { bg: "#101010" });
    applyTokens(el, { fg: "#fafafa" });
    // linkedom returns undefined for a removed property where a browser returns ""; both are unset.
    expect(el.style.getPropertyValue("--bg") || "").toBe("");
    expect(el.style.getPropertyValue("--fg")).toBe("#fafafa");
  });
});

describe("SizeReporter — bonnard:size protocol", () => {
  // A minimal measurable stand-in: linkedom has no layout, so drive scrollHeight/scrollWidth directly.
  const target = (height: number, width = 400) =>
    ({ scrollHeight: height, scrollWidth: width }) as unknown as HTMLElement;

  it("posts height and width on the first measurement", () => {
    const post = vi.fn();
    new SizeReporter(target(82), post).measure();
    expect(post).toHaveBeenCalledExactlyOnceWith({ type: "bonnard:size", height: 82, width: 400 });
  });

  it("dedupes: an unchanged measurement posts nothing", () => {
    const post = vi.fn();
    const el = target(82);
    const reporter = new SizeReporter(el, post);
    reporter.measure();
    reporter.measure();
    reporter.measure();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("posts again once the measurement changes", () => {
    const post = vi.fn();
    const el = { scrollHeight: 82, scrollWidth: 400 } as unknown as HTMLElement;
    const reporter = new SizeReporter(el, post);
    reporter.measure();
    (el as { scrollHeight: number }).scrollHeight = 120;
    reporter.measure();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith({ type: "bonnard:size", height: 120, width: 400 });
  });

  it("rounds a fractional measurement up (never reports a clipping height)", () => {
    const post = vi.fn();
    new SizeReporter(target(81.4), post).measure();
    expect(post).toHaveBeenCalledWith({ type: "bonnard:size", height: 82, width: 400 });
  });

  it("debounces: many schedule() calls in one frame collapse into a single post", () => {
    const post = vi.fn();
    const frames: (() => void)[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    try {
      const reporter = new SizeReporter(target(82), post);
      reporter.schedule();
      reporter.schedule();
      reporter.schedule();
      expect(frames).toHaveLength(1);
      expect(post).not.toHaveBeenCalled();
      frames[0]!();
      expect(post).toHaveBeenCalledTimes(1);
      // A later frame can schedule again.
      reporter.schedule();
      expect(frames).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stop() is safe without a ResizeObserver present", () => {
    const reporter = new SizeReporter(target(10), vi.fn());
    reporter.start();
    expect(() => reporter.stop()).not.toThrow();
  });
});

describe("bonnard:render payload kinds", () => {
  // main.ts dispatches on these guards in order: dashboard, chart, then (embed only) a bare item.
  it("a DashboardSpec is a dashboard, not a chart or an item", () => {
    const d = spec("grid-2x2");
    expect(isDashboardSpec(d)).toBe(true);
    expect(isChartSpec(d)).toBe(false);
  });

  it("a ChartSpec is a chart, not a dashboard", () => {
    expect(isChartSpec(chartSpec)).toBe(true);
    expect(isDashboardSpec(chartSpec)).toBe(false);
  });

  it("a bare KPI / text tile is a DashboardItem", () => {
    expect(isDashboardItem(kpi)).toBe(true);
    expect(isDashboardItem({ type: "text", text: "hello" })).toBe(true);
  });

  it("a bare chart cell is a DashboardItem", () => {
    expect(isDashboardItem({ type: "chart", spec: chartSpec })).toBe(true);
    expect(isDashboardItem({ spec: chartSpec })).toBe(true);
  });

  it("rejects non-items so an unrecognized payload still falls through to the empty state", () => {
    expect(isDashboardItem(null)).toBe(false);
    expect(isDashboardItem("kpi")).toBe(false);
    expect(isDashboardItem({ type: "sunburst" })).toBe(false);
    expect(isDashboardItem({ spec: { title: "not a chart" } })).toBe(false);
  });
});

describe("renderSingleItem — chrome-less cell", () => {
  it("KPI: no .cell wrapper, no border chrome, keeps the KPI internals", () => {
    const d = doc(renderSingleItem(kpi));
    expect(d.querySelector(".cell")).toBeNull();
    const solo = d.querySelector(".solo")!;
    expect(solo.className).toBe("solo kpi");
    expect(solo.querySelector(".kpi-label")?.textContent).toBe("Revenue");
    expect(solo.querySelector(".kpi-value")?.textContent).toContain("$128,400");
    expect(solo.querySelector(".kpi-delta.up")).toBeTruthy();
  });

  it("chart cell: no .cell wrapper, keeps the #cell-0 mount point main.ts paints", () => {
    const d = doc(renderSingleItem({ type: "chart", spec: chartSpec }));
    expect(d.querySelector(".cell")).toBeNull();
    const solo = d.querySelector(".solo.chart")!;
    const mount = solo.querySelector(".cell-chart")!;
    expect(mount.getAttribute("id")).toBe("cell-0");
    expect(mount.innerHTML).toBe("");
  });

  // The cell markup itself carries no title: main.ts composes one above it when `titled=true`, for
  // every single-cell shape. embed-browser.test.ts asserts the composed result in a real frame.
  it("draws no title of its own (main.ts owns single-cell title composition)", () => {
    const d = doc(renderSingleItem({ type: "chart", spec: chartSpec }));
    expect(d.querySelector(".title")).toBeNull();
    expect(d.querySelector(".dash-title")).toBeNull();
  });

  it("notes render by default and drop under notes=false", () => {
    expect(doc(renderSingleItem({ spec: chartSpec })).querySelector(".cell-notes")?.textContent).toContain(
      "Coerced revenue",
    );
    expect(doc(renderSingleItem({ spec: chartSpec }, { notes: false })).querySelector(".cell-notes")).toBeNull();
  });

  it("text tile keeps its heading and escapes strings", () => {
    const d = doc(renderSingleItem({ type: "text", heading: "Q2", text: "<img src=x>" }));
    expect(d.querySelector(".solo.text-block h3")?.textContent).toBe("Q2");
    expect(d.querySelector(".solo")?.innerHTML).not.toContain("<img");
  });

  it("unknown item kind renders the muted placeholder, not a throw", () => {
    const weird = { type: "sunburst" } as unknown as DashboardItem;
    expect(doc(renderSingleItem(weird)).querySelector(".solo.unsupported")?.textContent).toBe("Unsupported item");
  });

  it("drops the grid span: a single cell has no grid to span", () => {
    const d = doc(renderSingleItem({ type: "text", text: "wide", span: 3 } as DashboardItem));
    expect(d.querySelector(".solo")?.getAttribute("data-span")).toBeNull();
  });
});

describe("item selection — DashboardSpec + item: n", () => {
  // main.ts picks items[item] and hands it to renderSingleItem; these assert the selection is the
  // cell the consumer asked for, rendered chrome-less.
  const mixed = spec("mixed");

  it("selects the requested cell and only that cell", () => {
    const target = mixed.items[1]!;
    const d = doc(renderSingleItem(target));
    expect(d.querySelectorAll(".solo").length).toBe(1);
    expect(d.querySelector(".grid")).toBeNull();
    expect(d.querySelector(".cell")).toBeNull();
  });

  it("a different index selects a different cell kind", () => {
    // `mixed` is [text, kpi, kpi, chart]; each index resolves to its own chrome-less cell.
    const kindAt = (i: number) => doc(renderSingleItem(mixed.items[i]!)).querySelector(".solo")!.className;
    expect(kindAt(0)).toBe("solo text-block");
    expect(kindAt(1)).toBe("solo kpi");
    expect(kindAt(3)).toBe("solo chart");
  });

  it("fails closed on an unusable selector instead of falling back to the whole grid", () => {
    for (const item of [-1, 99, 1.5, "1", true]) {
      const picked = selectItem(mixed, { item });
      expect(picked && "code" in picked, String(item)).toBe(true);
    }
    expect(selectItem(mixed, { itemId: "nope" })).toMatchObject({ code: "item-not-found" });
    expect(selectItem(mixed, { itemId: "" })).toMatchObject({ code: "invalid-item-selector" });
  });

  it("no selector at all means the whole dashboard", () => {
    expect(selectItem(mixed, {})).toBeNull();
    expect(selectItem(mixed, { item: undefined })).toBeNull();
  });

  it("selects by index and by id", () => {
    expect(selectItem(mixed, { item: 1 })).toEqual({ item: mixed.items[1] });
    const withId = { items: [{ id: "a", type: "text" as const, text: "x" }] };
    expect(selectItem(withId, { itemId: "a" })).toEqual({ item: withId.items[0] });
  });
});

describe("renderDashboardShell — embed options", () => {
  it("titled:false suppresses the dashboard title but keeps the grid chrome", () => {
    const titled = doc(renderDashboardShell(spec("mixed")));
    expect(titled.querySelector(".dash-title")).toBeTruthy();
    const untitled = doc(renderDashboardShell(spec("mixed"), { titled: false }));
    expect(untitled.querySelector(".dash-title")).toBeNull();
    expect(untitled.querySelectorAll(".cell").length).toBe(titled.querySelectorAll(".cell").length);
  });

  it("notes:false suppresses .dash-notes and .cell-notes", () => {
    const withNotes: DashboardSpec = {
      notes: ["Capped at 30 categories."],
      items: [{ spec: chartSpec }],
    };
    const off = doc(renderDashboardShell(withNotes, { notes: false }));
    expect(off.querySelector(".dash-notes")).toBeNull();
    expect(off.querySelector(".cell-notes")).toBeNull();
    const on = doc(renderDashboardShell(withNotes));
    expect(on.querySelector(".dash-notes")).toBeTruthy();
    expect(on.querySelector(".cell-notes")).toBeTruthy();
  });

  it("defaults are unchanged, so the host-surface render is untouched", () => {
    expect(renderDashboardShell(spec("mixed"), {})).toBe(renderDashboardShell(spec("mixed")));
  });
});

describe("protocol version", () => {
  // The emitted `bonnard:ready` message is asserted in embed-browser.test.ts; this pins the value.
  it("is 1", () => {
    expect(EMBED_PROTOCOL_VERSION).toBe(1);
  });
});

// The gallery cases at examples/embed/ (where the real-pixel check happens), locked structurally so
// the markup a consumer sees cannot drift silently.
describe("embed fixtures — markup snapshots", () => {
  for (const fx of embedFixtures) {
    it(`embed markup: ${fx.name}`, () => {
      const payload = fx.item == null ? fx.payload : (fx.payload as DashboardSpec).items[fx.item]!;
      const html = isDashboardSpec(payload)
        ? renderDashboardShell(payload, { titled: false })
        : isChartSpec(payload)
          ? renderSingleItem({ type: "chart", spec: payload })
          : renderSingleItem(payload);
      expect(html).toMatchSnapshot();
    });

    it(`no host chrome or widget title: ${fx.name}`, () => {
      const payload = fx.item == null ? fx.payload : (fx.payload as DashboardSpec).items[fx.item]!;
      if (isDashboardSpec(payload)) {
        // A whole dashboard keeps its grid inside the consumer's container; only the outer title goes.
        expect(doc(renderDashboardShell(payload, { titled: false })).querySelector(".dash-title")).toBeNull();
        return;
      }
      const item = isChartSpec(payload) ? ({ type: "chart", spec: payload } as DashboardItem) : payload;
      const d = doc(renderSingleItem(item));
      expect(d.querySelector(".cell")).toBeNull();
      expect(d.querySelector(".title")).toBeNull();
      expect(d.querySelector(".dash-title")).toBeNull();
    });
  }

  it("every chart fixture is fill-sized and every intrinsic cell is content-sized", () => {
    // Documents the contract the CSS implements: a chart has no intrinsic height, the rest do.
    for (const fx of embedFixtures) {
      const payload = fx.item == null ? fx.payload : (fx.payload as DashboardSpec).items[fx.item]!;
      if (isDashboardSpec(payload)) continue;
      const spec = isChartSpec(payload) ? payload : "spec" in payload ? payload.spec : undefined;
      const isFillChart = !!spec && spec.chartType !== "table";
      expect(fx.sizing).toBe(isFillChart ? "fill" : "content");
    }
  });
});

describe("validatePayload — runtime guards and caps", () => {
  it("accepts the three documented payload shapes", () => {
    expect(validatePayload(chartSpec)).toBeNull();
    expect(validatePayload(kpi)).toBeNull();
    expect(validatePayload(spec("mixed"))).toBeNull();
    expect(validatePayload({ type: "chart", spec: chartSpec })).toBeNull();
    expect(validatePayload({ type: "text", text: "hi" })).toBeNull();
  });

  // Each of these passed the 0.3.0 guards and then threw or rendered "undefined".
  it("refuses the shapes that used to throw or render nonsense", () => {
    expect(validatePayload({ items: [null] })).toMatchObject({ code: "invalid-payload" });
    expect(validatePayload({ type: "text" })).toMatchObject({ code: "invalid-payload" });
    expect(validatePayload({ data: [{}] })).toMatchObject({ code: "invalid-payload" });
    expect(validatePayload({ type: "kpi", value: 1 })).toMatchObject({ code: "invalid-payload" });
    expect(validatePayload(null)).toMatchObject({ code: "invalid-payload" });
    expect(validatePayload("dark")).toMatchObject({ code: "invalid-payload" });
    expect(validatePayload([1, 2])).toMatchObject({ code: "invalid-payload" });
    expect(validatePayload({ items: [{ spec: { title: "not a chart" } }] })).toMatchObject({ code: "invalid-payload" });
  });

  it("requires the fields each chart kind actually renders from", () => {
    expect(validatePayload({ chartType: "bar", data: [{ a: 1 }] })).toMatchObject({ code: "invalid-payload" });
    expect(validatePayload({ chartType: "bar", data: [{ a: 1 }], x: 5, series: [{ key: "a" }] })).toMatchObject({
      code: "invalid-payload",
    });
    // A table needs no series.
    expect(validatePayload({ chartType: "table", data: [{ a: 1 }], columns: [{ key: "a" }] })).toBeNull();
  });

  it("enforces the caps", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));
    expect(
      validatePayload({ chartType: "bar", x: "i", series: [{ key: "i" }], data: rows(EMBED_LIMITS.maxRows + 1) }),
    ).toMatchObject({ code: "payload-too-large" });
    expect(
      validatePayload({
        items: Array.from({ length: EMBED_LIMITS.maxItems + 1 }, () => ({ type: "text", text: "x" })),
      }),
    ).toMatchObject({ code: "payload-too-large" });
    expect(validatePayload({ type: "text", text: "x".repeat(EMBED_LIMITS.maxStringLength + 1) })).toMatchObject({
      code: "payload-too-large",
    });
    expect(
      validatePayload({
        chartType: "bar",
        x: "i",
        data: [{ i: 1 }],
        series: Array.from({ length: EMBED_LIMITS.maxSeries + 1 }, (_, i) => ({ key: `s${i}` })),
      }),
    ).toMatchObject({ code: "payload-too-large" });
  });

  it("refuses a deeply nested payload rather than recursing without bound", () => {
    let nested: Record<string, unknown> = { type: "text", text: "deep" };
    for (let i = 0; i < 40; i++) nested = { nested };
    expect(validatePayload(nested)).toMatchObject({ code: "payload-too-large" });
  });
});
