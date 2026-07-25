// Embed mode: fragment parsing, token validation, the size-report protocol, and the chrome-less
// single-cell markup. Structural (linkedom) in the same style as dashboard.test.ts; the real-pixel
// checks live in examples/embed/index.html.
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

  it("bare #embed: untitled, notes on, no theme override", () => {
    expect(parseEmbedFragment("#embed")).toEqual({ titled: false, theme: undefined, notes: true });
  });

  it("parses flags after #embed", () => {
    expect(parseEmbedFragment("#embed&titled=true&theme=dark&notes=false")).toEqual({
      titled: true,
      theme: "dark",
      notes: false,
    });
  });

  it("bare and 1/true flag spellings all read as on", () => {
    for (const hash of ["#embed&titled", "#embed&titled=", "#embed&titled=1", "#embed&titled=true"]) {
      expect(parseEmbedFragment(hash)?.titled).toBe(true);
    }
    expect(parseEmbedFragment("#embed&titled=false")?.titled).toBe(false);
    expect(parseEmbedFragment("#embed&titled=no")?.titled).toBe(false);
  });

  it("ignores an unknown theme and unknown flags (forward compatibility)", () => {
    expect(parseEmbedFragment("#embed&theme=neon&kiosk=2")).toEqual({ titled: false, theme: undefined, notes: true });
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
        grid: "#eee",
        border: "#eee",
        fontFamily: "Inter, system-ui, sans-serif",
      }),
    ).toEqual({
      bg: "#fff",
      fg: "rgb(10 10 10)",
      muted: "#6b7280",
      grid: "#eee",
      border: "#eee",
      fontFamily: "Inter, system-ui, sans-serif",
    });
  });

  it("drops unknown keys", () => {
    expect(sanitizeTokens({ bg: "#fff", accent: "#f00", palette: ["#f00"], radius: "8px" })).toEqual({ bg: "#fff" });
  });

  it("drops non-strings, blanks, over-long values, and CSS-structural characters", () => {
    expect(sanitizeTokens({ bg: 123 })).toEqual({});
    expect(sanitizeTokens({ bg: "   " })).toEqual({});
    expect(sanitizeTokens({ bg: "#" + "f".repeat(200) })).toEqual({});
    expect(sanitizeTokens({ bg: "red; background: url(x)" })).toEqual({});
    expect(sanitizeTokens({ fg: "red} body {color:blue" })).toEqual({});
    expect(sanitizeTokens({ bg: "url(https://evil.example/x.png)" })).toEqual({});
    expect(sanitizeTokens({ fg: "expression(alert(1))" })).toEqual({});
    expect(sanitizeTokens({ bg: "@import 'x'" })).toEqual({});
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
    expect(el.style.getPropertyValue("font-family")).toBe("Inter");
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

  it("never draws the widget's own title (the consumer's header is the one header)", () => {
    const d = doc(renderSingleItem({ type: "chart", spec: chartSpec }));
    expect(d.querySelector(".title")).toBeNull();
    expect(d.querySelector(".dash-title")).toBeNull();
    expect(renderSingleItem({ type: "chart", spec: chartSpec })).not.toContain("Revenue by region");
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

  it("an out-of-range index selects nothing, so the whole grid renders instead", () => {
    expect(mixed.items[99]).toBeUndefined();
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
  it("bonnard:ready carries version 1", () => {
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
