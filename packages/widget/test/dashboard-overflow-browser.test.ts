// Real-pixel overflow tests for dashboard text/notes cells, against the BUILT widget in a real
// browser. Companion to kpi-overflow-browser.test.ts, same measurement approach: linkedom has no
// layout engine, so only a real browser can prove a laid-out element fits its cell.
//
// Regression for: `.text-block .text-body`, `.dash-notes`, `.cell-notes` had no overflow-wrap rule
// (unlike the KPI parts, which got one earlier), so a long unbreakable token — a raw column name in
// a guardrail note, a URL in a text tile — spilled past its cell. The same gap let the whole `.grid`
// overflow its frame: `minmax(0, 1fr)` + `.cell { min-width: 0 }` cannot save a track whose min-
// content width is set by an unbreakable string in a child with no wrap rule.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser, Page } from "puppeteer-core";
import { installDriver, launchBrowser, startServer } from "./browser-helpers.js";

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
  await page.setViewport({ width: 900, height: 900 });
  await page.goto(`${baseUrl}/parent.html`);
  await installDriver(page, baseUrl);
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await stop?.();
});

// A single unbroken token, the shape that actually breaks this: a warehouse column name or a URL,
// never a natural word-wrap point.
const LONG_TOKEN = "gross_merchandise_value_by_region_and_channel_and_fiscal_quarter_running_total";

const ITEMS = [
  { type: "text", heading: "Notes", text: LONG_TOKEN },
  {
    spec: {
      chartType: "bar",
      data: [
        { x: "a", y: 1 },
        { x: "b", y: 2 },
      ],
      x: "x",
      series: [{ key: "y", label: "y" }],
      legend: false,
      notes: [`Ignored unknown encode column "${LONG_TOKEN}"`],
    },
  },
] as const;

interface Measured {
  selector: string;
  clientWidth: number;
  inkWidth: number;
  /** How far the ink escapes the cell's content box, in px (<= 0 means it fits). */
  spill: number;
}

/** Render the dashboard at a given grid width and column count, and measure the notes/text cells
 *  plus the grid itself. */
async function measure(
  boxWidth: number,
  columns: number,
): Promise<{ grid: { scrollWidth: number; clientWidth: number }; parts: Measured[] }> {
  await page.evaluate((w) => {
    (document.getElementById("box") as HTMLElement).style.width = `${w}px`;
  }, boxWidth);
  await page.evaluate(() => window.__mount("#embed", { sandbox: false, height: 700 }));
  await page.evaluate(() => window.__waitReady());
  await page.evaluate((payload) => window.__send({ type: "bonnard:render", payload }), {
    columns,
    items: ITEMS,
    notes: [LONG_TOKEN],
  } as unknown as Record<string, unknown>);
  await new Promise((r) => setTimeout(r, 300));
  return page.evaluate(() => {
    const frame = document.querySelector("#box iframe") as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    const win = frame.contentWindow!;
    const grid = doc.querySelector(".grid") as HTMLElement;
    const measure = (el: HTMLElement, selector: string): Measured => {
      const cell = el.closest(".cell") as HTMLElement;
      const cellStyle = win.getComputedStyle(cell);
      const contentWidth =
        cell.getBoundingClientRect().width -
        parseFloat(cellStyle.paddingLeft) -
        parseFloat(cellStyle.paddingRight) -
        parseFloat(cellStyle.borderLeftWidth) -
        parseFloat(cellStyle.borderRightWidth);
      const range = doc.createRange();
      range.selectNodeContents(el);
      const inkWidth = Math.max(...[...range.getClientRects()].map((r) => r.width), 0);
      return {
        selector,
        clientWidth: Math.round(el.clientWidth),
        inkWidth: Math.round(inkWidth * 100) / 100,
        spill: Math.round((inkWidth - contentWidth) * 100) / 100,
      };
    };
    const parts: Measured[] = [];
    const textBody = doc.querySelector(".text-block .text-body") as HTMLElement | null;
    if (textBody) parts.push(measure(textBody, ".text-body"));
    const cellNotes = doc.querySelector(".cell-notes") as HTMLElement | null;
    if (cellNotes) parts.push(measure(cellNotes, ".cell-notes"));
    // .dash-notes sits outside .grid, so measure it against the grid's own box.
    const dashNotes = doc.querySelector(".dash-notes") as HTMLElement | null;
    if (dashNotes) {
      const contentWidth = grid.getBoundingClientRect().width;
      const range = doc.createRange();
      range.selectNodeContents(dashNotes);
      const inkWidth = Math.max(...[...range.getClientRects()].map((r) => r.width), 0);
      parts.push({
        selector: ".dash-notes",
        clientWidth: Math.round(dashNotes.clientWidth),
        inkWidth: Math.round(inkWidth * 100) / 100,
        spill: Math.round((inkWidth - contentWidth) * 100) / 100,
      });
    }
    return {
      grid: { scrollWidth: Math.round(grid.scrollWidth), clientWidth: Math.round(grid.clientWidth) },
      parts,
    };
  });
}

const OVERFLOW_TOLERANCE_PX = 1;

// Widths bracket the reported failure (a ~760px preview) and a tighter host pane.
const LAYOUTS = [
  { width: 760, columns: 4 },
  { width: 760, columns: 2 },
  { width: 420, columns: 4 },
] as const;

describe("dashboard text/notes cells never overflow their cell or the grid", () => {
  for (const { width, columns } of LAYOUTS) {
    it(`${columns} columns at ${width}px`, async () => {
      const { grid, parts } = await measure(width, columns);
      expect(parts.length).toBeGreaterThan(0);
      expect(parts.filter((p) => p.spill > OVERFLOW_TOLERANCE_PX)).toEqual([]);
      expect(grid.scrollWidth - grid.clientWidth).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
    });
  }
});
