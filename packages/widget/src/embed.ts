// Embed mode: the public "render one cell inside your own layout" surface. Activated by the
// `#embed` URL fragment (with optional `&`-separated flags), it strips the widget's own chrome and
// reports content height to the parent so a consumer can size the iframe from an opaque origin.
//
// Kept separate from main.ts so the mode is parse-time knowable (no flash of host-surface CSS) and
// so everything here is inert when the fragment is absent.

/** Public presentation flags carried on the `#embed` fragment. */
export interface EmbedConfig {
  /** Render the widget's own title (`.title` / `.dash-title`). Default false: your header wins. */
  titled: boolean;
  /** Initial theme, overridable per `bonnard:render` message. */
  theme?: "light" | "dark";
  /** Render per-cell guardrail advisories (`.cell-notes` / `.dash-notes`). Default true. */
  notes: boolean;
}

/** Bounded theme tokens, mapped onto the widget's CSS custom properties. */
export interface EmbedTokens {
  bg?: string;
  fg?: string;
  muted?: string;
  grid?: string;
  border?: string;
  fontFamily?: string;
}

/** Bumped when the message contract changes shape. Carried on `bonnard:ready`. */
export const EMBED_PROTOCOL_VERSION = 1;

const TOKEN_PROPERTY: Record<keyof EmbedTokens, string> = {
  bg: "--bg",
  fg: "--fg",
  muted: "--muted",
  grid: "--grid",
  border: "--border",
  fontFamily: "font-family",
};

const TOKEN_MAX_LENGTH = 120;
const TOKEN_FORBIDDEN = /[;{}]|url\(|@import|expression\(/i;

const isTruthyFlag = (v: string | null) => v === null || v === "" || v === "true" || v === "1";

/**
 * Parse the URL fragment. Returns null unless it starts with `embed` (so `#harness` and the
 * fragment-less MCP resource path are untouched). Flags follow as a query string:
 * `#embed&titled=true&theme=dark&notes=false`.
 */
export function parseEmbedFragment(hash: string): EmbedConfig | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw !== "embed" && !raw.startsWith("embed&") && !raw.startsWith("embed?")) return null;
  const params = new URLSearchParams(raw.slice("embed".length).replace(/^[&?]/, ""));
  const theme = params.get("theme");
  return {
    titled: params.has("titled") ? isTruthyFlag(params.get("titled")) : false,
    theme: theme === "light" || theme === "dark" ? theme : undefined,
    notes: params.has("notes") ? isTruthyFlag(params.get("notes")) : true,
  };
}

/**
 * Keep only tokens we own, whose values a CSS custom property can safely hold. Anything unknown,
 * non-string, over-long, or containing CSS-structural characters is dropped: values reach the DOM
 * through `setProperty`, never as CSS text.
 */
export function sanitizeTokens(input: unknown): EmbedTokens {
  const out: EmbedTokens = {};
  if (!input || typeof input !== "object") return out;
  for (const key of Object.keys(TOKEN_PROPERTY) as (keyof EmbedTokens)[]) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > TOKEN_MAX_LENGTH || TOKEN_FORBIDDEN.test(trimmed)) continue;
    out[key] = trimmed;
  }
  return out;
}

/** Apply sanitized tokens to the root element, clearing any previously-set ones. */
export function applyTokens(el: HTMLElement, tokens: EmbedTokens): void {
  for (const key of Object.keys(TOKEN_PROPERTY) as (keyof EmbedTokens)[]) {
    const property = TOKEN_PROPERTY[key];
    const value = tokens[key];
    if (value) el.style.setProperty(property, value);
    else el.style.removeProperty(property);
  }
}

/**
 * Content-height reporter, following the iframe-resizer convention: the child measures and posts,
 * the consumer opts in by listening. Coalesced to one message per animation frame and suppressed
 * when the measurement is unchanged.
 */
export class SizeReporter {
  private observer: ResizeObserver | null = null;
  private frame: number | null = null;
  private lastHeight = -1;
  private lastWidth = -1;

  constructor(
    private readonly target: HTMLElement,
    private readonly post: (message: { type: "bonnard:size"; height: number; width: number }) => void,
  ) {}

  /** Start observing. Idempotent. */
  start(): void {
    if (this.observer || typeof ResizeObserver === "undefined") return;
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(this.target);
  }

  /** Queue a measurement for the next frame; repeated calls within a frame collapse into one. */
  schedule(): void {
    if (this.frame !== null) return;
    const run = () => {
      this.frame = null;
      this.measure();
    };
    this.frame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(run)
        : (setTimeout(run, 0) as unknown as number);
  }

  /** Measure and post immediately, unless the value is unchanged. */
  measure(): void {
    const height = Math.ceil(this.target.scrollHeight);
    const width = Math.ceil(this.target.scrollWidth);
    if (height === this.lastHeight && width === this.lastWidth) return;
    this.lastHeight = height;
    this.lastWidth = width;
    this.post({ type: "bonnard:size", height, width });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}
