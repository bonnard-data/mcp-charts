// Real-pixel overflow tests for KPI tiles, against the BUILT widget in a real browser.
//
// linkedom has no layout engine, so the structural suite can only assert that a CSS rule exists,
// never that a value fits its cell. This file measures the laid-out `.kpi-value` (scrollWidth vs
// clientWidth, and the text's own ink width against the cell's content box) across magnitudes,
// currency prefixes, column counts, and viewport widths.
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

interface Measured {
  /** Which line of the tile was measured: the label, the value, or the caption. */
  part: string;
  text: string;
  /** The element's own box, and the widest laid-out line inside it. */
  clientWidth: number;
  scrollWidth: number;
  inkWidth: number;
  fontSize: number;
  /** How far the ink escapes the cell's content box, in px (<= 0 means it fits). */
  spill: number;
}

const KPIS = [
  // The reported failure: a full-digit GBP amount, 17 characters, one break opportunity.
  { type: "kpi", label: "Gross merchandise value", value: 1648745000, format: "currency", currency: "GBP" },
  { type: "kpi", label: "Orders", value: 42, format: "number" },
  { type: "kpi", label: "Revenue", value: 128400, format: "currency", currency: "USD", delta: 0.12 },
  { type: "kpi", label: "Pipeline", value: 987654.32, format: "currency", currency: "EUR" },
  { type: "kpi", label: "Net position", value: -1234567.89, format: "currency", currency: "GBP" },
  { type: "kpi", label: "Conversion", value: 0.184, format: "percent", delta: -0.02 },
  { type: "kpi", label: "Annualised recurring revenue, all regions", value: 98765432100, format: "currency", currency: "JPY" }, // prettier-ignore
  // A label and caption straight off a warehouse column: long, and with no break opportunity.
  { type: "kpi", label: "gross_merchandise_value_gbp_running_total", value: 42, caption: "vs_previous_period_rolling_12_months" }, // prettier-ignore
] as const;

/** Render the KPI set at a given grid width and column count, and measure every tile. */
async function measure(boxWidth: number, columns: number): Promise<Measured[]> {
  await page.evaluate((w) => {
    (document.getElementById("box") as HTMLElement).style.width = `${w}px`;
  }, boxWidth);
  // sandbox:false so the parent can read the frame's laid-out DOM; the CSS under test is
  // origin-independent.
  await page.evaluate(() => window.__mount("#embed", { sandbox: false, height: 700 }));
  await page.evaluate(() => window.__waitReady());
  await page.evaluate((payload) => window.__send({ type: "bonnard:render", payload }), {
    columns,
    items: KPIS,
  } as unknown as Record<string, unknown>);
  await new Promise((r) => setTimeout(r, 300));
  return page.evaluate(() => {
    const frame = document.querySelector("#box iframe") as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    const win = frame.contentWindow!;
    return [...doc.querySelectorAll<HTMLElement>(".cell.kpi")].flatMap((cell) => {
      const cellStyle = win.getComputedStyle(cell);
      const contentWidth =
        cell.getBoundingClientRect().width -
        parseFloat(cellStyle.paddingLeft) -
        parseFloat(cellStyle.paddingRight) -
        parseFloat(cellStyle.borderLeftWidth) -
        parseFloat(cellStyle.borderRightWidth);
      return ["kpi-label", "kpi-value", "kpi-caption"].flatMap((part) => {
        const el = cell.querySelector<HTMLElement>(`.${part}`);
        if (!el) return [];
        const range = doc.createRange();
        range.selectNodeContents(el);
        // The widest laid-out line, not the union box: a wrapped line's union is the full width.
        const inkWidth = Math.max(...[...range.getClientRects()].map((r) => r.width), 0);
        return [
          {
            part,
            text: el.textContent!,
            clientWidth: Math.round(el.clientWidth),
            scrollWidth: Math.round(el.scrollWidth),
            inkWidth: Math.round(inkWidth * 100) / 100,
            fontSize: parseFloat(win.getComputedStyle(el).fontSize),
            spill: Math.round((inkWidth - contentWidth) * 100) / 100,
          },
        ];
      });
    });
  });
}

// Chrome rounds scrollWidth/clientWidth to integers, so a value that fits to the sub-pixel can
// still report a 1px difference. Anything past that is real overflow.
const OVERFLOW_TOLERANCE_PX = 1;

function overflowing(tiles: Measured[]): Measured[] {
  return tiles.filter((t) => t.scrollWidth - t.clientWidth > OVERFLOW_TOLERANCE_PX || t.spill > OVERFLOW_TOLERANCE_PX);
}

// Widths bracket the reported failure (a ~760px preview) and a tighter host pane. 600px keeps the
// multi-column grid: below 560px the responsive rule collapses it to one column.
const LAYOUTS = [
  { width: 760, columns: 4 },
  { width: 760, columns: 2 },
  { width: 600, columns: 4 },
  { width: 600, columns: 2 },
  { width: 420, columns: 4 },
] as const;

describe("KPI values never overflow their cell", () => {
  for (const { width, columns } of LAYOUTS) {
    it(`${columns} columns at ${width}px`, async () => {
      const tiles = await measure(width, columns);
      expect(tiles.filter((t) => t.part === "kpi-value")).toHaveLength(KPIS.length);
      expect(overflowing(tiles)).toEqual([]);
    });
  }

  it("keeps the full 26px size when the cell is wide enough", async () => {
    const values = (await measure(760, 2)).filter((t) => t.part === "kpi-value");
    expect(values[1].fontSize).toBe(26);
  });
});
