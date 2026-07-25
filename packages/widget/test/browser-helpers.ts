// Real-browser harness for the embed integration tests. Loads the BUILT single-file widget
// (`dist/index.html`, the exact bytes core ships as WIDGET_HTML) from a local server, inside an
// opaque-origin `sandbox="allow-scripts"` iframe, and drives it over postMessage.
//
// jsdom cannot stand in here: the assertions that matter (ready timing, `data-embed`, body padding,
// and content-height convergence) all depend on real layout and a real origin boundary.
import { createServer, type Server } from "node:http";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "puppeteer-core";

const here = dirname(fileURLToPath(import.meta.url));
const WIDGET_PATH = join(here, "..", "dist", "index.html");

/** The parent page: an empty stage plus the helpers the tests drive it with. */
// The stage sits first in the body and the viewport is tall enough to contain it, so a mounted
// frame is ON SCREEN. Chrome throttles requestAnimationFrame for offscreen cross-origin frames, and
// the size reporter is rAF-coalesced, so an offscreen frame would report nothing at all.
const PARENT_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>embed test parent</title>
<style>body{margin:0}#box{width:400px;height:260px}
/* The container owns the height and the frame fills it, which is the posture the docs recommend.
   A stylesheet rule (not an inline style) is what lets the parent RELEASE an applied inline height
   and fall back to the container, instead of dropping to the iframe default of ~150px. */
#box iframe{width:100%;height:100%;border:0;display:block}</style></head>
<body><div id="box"></div></body></html>`;

export function widgetHtml(): string {
  if (!existsSync(WIDGET_PATH)) {
    throw new Error(`Built widget not found at ${WIDGET_PATH}. Run \`pnpm build\` in packages/widget first.`);
  }
  return readFileSync(WIDGET_PATH, "utf8");
}

/** Serve the built widget and the parent stage over http, so the iframe gets a real origin. */
export async function startServer(): Promise<{ url: string; close: () => Promise<void>; server: Server }> {
  const html = widgetHtml();
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/widget.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.url?.startsWith("/parent.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PARENT_HTML);
      return;
    }
    res.writeHead(404).end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind test server");
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Locate a Chrome to drive. Prefers whatever puppeteer already has cached (CI and this machine both
 * have one), then a system install, so the suite adds no download step.
 */
function chromePath(): string {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const home = process.env.HOME ?? "";
  const cacheRoots = [
    join(home, ".cache", "puppeteer", "chrome"),
    join(home, ".cache", "puppeteer", "chrome-headless-shell"),
  ];
  for (const root of cacheRoots) {
    if (!existsSync(root)) continue;
    // Newest revision first, so a refreshed cache is picked up without touching this file.
    const revisions = readdirSorted(root);
    for (const rev of revisions) {
      for (const candidate of [
        join(
          root,
          rev,
          "chrome-mac-arm64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        join(
          root,
          rev,
          "chrome-mac-x64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        join(root, rev, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
        join(root, rev, "chrome-headless-shell-mac-x64", "chrome-headless-shell"),
        join(root, rev, "chrome-linux64", "chrome"),
        join(root, rev, "chrome-headless-shell-linux64", "chrome-headless-shell"),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  for (const system of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]) {
    if (existsSync(system)) return system;
  }
  throw new Error("No Chrome found. Set PUPPETEER_EXECUTABLE_PATH to a Chrome binary.");
}

function readdirSorted(dir: string): string[] {
  return readdirSync(dir).sort().reverse();
}

export async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");
  return puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars=false"],
  });
}

/** What a test observes: every message the frame posted, in order, with arrival offsets. */
export interface Captured {
  type: string;
  data: Record<string, unknown>;
  /** ms after the frame was mounted. */
  t: number;
  /** Whether the message came from the frame we mounted. */
  fromFrame: boolean;
}

declare global {
  interface Window {
    __log: Captured[];
    __mount: (hash: string, opts?: { sandbox?: boolean; height?: number }) => Promise<void>;
    __send: (message: unknown) => void;
    __waitReady: (timeoutMs?: number) => Promise<number | null>;
    /**
     * Drive the parent's size handling.
     * `naive` applies `height` unconditionally (the handler docs shipped in 0.3.0).
     * `correct` branches on `sizing` and releases the height when the payload fills.
     */
    __applyHeights: (mode: false | "naive" | "correct") => void;
    __frameState: () => Record<string, unknown>;
    /** The frame's laid-out height, and the inline height the parent has applied. */
    __frameBox: () => { height: number; styleHeight: string };
  }
}

/**
 * Install the parent-side driver into the page. Kept as one injected function so each test file
 * shares the same mount/observe semantics.
 */
export async function installDriver(page: Page, baseUrl: string): Promise<void> {
  await page.evaluate((base: string) => {
    let frame: HTMLIFrameElement | null = null;
    let t0 = performance.now();
    let applyHeights: false | "naive" | "correct" = false;
    window.__log = [];

    window.addEventListener("message", (e) => {
      const d = (e.data ?? {}) as Record<string, unknown>;
      const fromFrame = !!frame && e.source === frame.contentWindow;
      const type = typeof d.type === "string" ? d.type : typeof d.method === "string" ? `rpc:${d.method}` : "(untyped)";
      window.__log.push({ type, data: d, t: Math.round(performance.now() - t0), fromFrame });
      if (applyHeights && fromFrame && d.type === "bonnard:size" && frame) {
        if (applyHeights === "naive") {
          // Verbatim the handler the docs used to show. Kept so a test can prove it is now safe.
          frame.style.height = `${d.height as number}px`;
        } else if (d.sizing === "content") {
          frame.style.height = `${d.height as number}px`;
        } else {
          // sizing: "fill" means release: fall back to the parent's own layout height.
          frame.style.removeProperty("height");
        }
      }
    });

    window.__mount = (hash, opts = {}) =>
      new Promise<void>((resolve) => {
        const box = document.getElementById("box")!;
        box.innerHTML = "";
        box.style.height = `${opts.height ?? 260}px`;
        window.__log = [];
        t0 = performance.now();
        const f = document.createElement("iframe");
        if (opts.sandbox !== false) f.setAttribute("sandbox", "allow-scripts");
        // No inline height: the stage's `#box iframe` rule supplies `height:100%`, so releasing an
        // applied inline height returns the frame to the container's height.
        f.addEventListener("load", () => resolve());
        f.src = `${base}/widget.html${hash}`;
        box.appendChild(f);
        frame = f;
      });

    window.__send = (message) => frame!.contentWindow!.postMessage(message, "*");

    window.__waitReady = (timeoutMs = 3000) =>
      new Promise<number | null>((resolve) => {
        const started = performance.now();
        const check = () => {
          const hit = window.__log.find((m) => m.type === "bonnard:ready" && m.fromFrame);
          if (hit) return resolve(hit.t);
          if (performance.now() - started > timeoutMs) return resolve(null);
          requestAnimationFrame(check);
        };
        check();
      });

    window.__applyHeights = (mode) => {
      applyHeights = mode;
    };

    window.__frameBox = () => ({
      height: Math.round(frame!.getBoundingClientRect().height),
      styleHeight: frame!.style.height,
    });

    // Same-origin only: lets a test read `data-embed`, computed padding, and rendered DOM. The
    // embed logic itself is origin-independent, which the sandboxed cases assert separately.
    window.__frameState = () => {
      const doc = frame!.contentDocument!;
      const el = doc.documentElement;
      return {
        dataEmbed: el.getAttribute("data-embed"),
        dataSizing: el.getAttribute("data-sizing"),
        dataTheme: el.getAttribute("data-theme"),
        bodyPadding: frame!.contentWindow!.getComputedStyle(doc.body).padding,
        rootHTML: doc.getElementById("root")!.innerHTML,
        hasSvg: !!doc.querySelector("svg"),
        titleText: doc.querySelector(".title")?.textContent ?? null,
        tokens: {
          bg: el.style.getPropertyValue("--bg"),
          fg: el.style.getPropertyValue("--fg"),
          muted: el.style.getPropertyValue("--muted"),
          border: el.style.getPropertyValue("--border"),
          fontFamily: el.style.getPropertyValue("--font-family"),
        },
        bodyBackgroundImage: frame!.contentWindow!.getComputedStyle(doc.body).backgroundImage,
      };
    };
  }, baseUrl);
}

/** Payload fixtures shared by the browser specs. */
export const KPI = {
  type: "kpi" as const,
  label: "Revenue",
  value: 128400,
  format: "currency" as const,
  currency: "USD",
  delta: 0.12,
};

export const CHART = {
  chartType: "bar" as const,
  title: "Revenue by region",
  data: [
    { region: "EMEA", revenue: 10 },
    { region: "APAC", revenue: 14 },
  ],
  x: "region",
  series: [{ key: "revenue", label: "Revenue" }],
};

export const TABLE = {
  chartType: "table" as const,
  title: "Revenue table",
  data: [
    { region: "EMEA", revenue: 10 },
    { region: "APAC", revenue: 14 },
  ],
  columns: [{ key: "region" }, { key: "revenue" }],
};
