// Embed mode: the public "render one cell inside your own layout" surface. Activated by the
// `#embed` URL fragment (with optional `&`-separated flags), it strips the widget's own chrome and
// reports content height to the parent so a consumer can size the iframe from an opaque origin.
//
// Kept separate from main.ts so the mode is parse-time knowable (no flash of host-surface CSS) and
// so everything here is inert when the fragment is absent.
import type { DecisionAudience } from "@bonnard/mcp-charts";
import { ALL_AUDIENCES } from "./decisions.js";

/** Public presentation flags carried on the `#embed` fragment. */
export interface EmbedConfig {
  /** Render the widget's own title (`.title` / `.dash-title`). Default false: your header wins. */
  titled: boolean;
  /** Initial theme. A later `bonnard:render` theme becomes a persistent override. */
  theme?: "light" | "dark";
  /** Whose decisions render as captions (`.cell-notes` / `.dash-notes`). Default `["viewer"]`. */
  audiences: DecisionAudience[];
}

/**
 * Bounded theme tokens, mapped onto the widget's CSS custom properties.
 *
 * Colour tokens must satisfy a strict colour grammar; `fontFamily` a conservative font-list
 * grammar. Anything else is dropped. These theme the HTML surface (page, text, tables, tiles,
 * notes) only: ECharts axis, grid, legend, tooltip, and font styling are not themed by tokens.
 */
export interface EmbedTokens {
  /** Page background. Applied as `background-color`. */
  bg?: string;
  /** Body text colour. */
  fg?: string;
  /** Labels, captions, notes. */
  muted?: string;
  /** Table rules and cell borders. */
  border?: string;
  /** Font stack for the HTML surface. Not applied to chart text. */
  fontFamily?: string;
}

/** Bumped when the message contract changes shape. Carried on `bonnard:ready`. */
export const EMBED_PROTOCOL_VERSION = 1;

const TOKEN_PROPERTY: Record<keyof EmbedTokens, string> = {
  bg: "--bg",
  fg: "--fg",
  muted: "--muted",
  border: "--border",
  fontFamily: "--font-family",
};

const TOKEN_MAX_LENGTH = 120;

// --- Colour grammar -------------------------------------------------------------------------
// An allowlist, not a denylist: a value must match one of these shapes in full or it is dropped.
// No escapes, no `var()` indirection, no functions beyond the numeric colour ones below, so a
// value can never tokenize into `url()` / `image-set()` and reach the network.

// Backslash escapes, control characters, and newlines: refused before any grammar check, since
// they are exactly how a substring denylist gets bypassed (`u\\72l(...)` tokenizes as `url()`).
// eslint-disable-next-line no-control-regex -- matching control characters is the guard's job
const UNSAFE_CHARS = /[\\\u0000-\u001f\u007f]/;

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// A numeric colour component: number, percentage, or `none`. Angles allowed for hue.
const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:%|deg|grad|rad|turn)?`;
const COMPONENT = new RegExp(String.raw`^(?:${NUM}|none)$`, "i");
const COLOUR_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch"]);

// Named CSS colours a design system realistically passes, plus the keywords. Deliberately short:
// an unlisted name is dropped rather than guessed at, and hex/rgb() cover everything else.
const COLOUR_KEYWORDS = new Set([
  "transparent",
  "currentcolor",
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "purple",
  "gray",
  "grey",
  "silver",
  "navy",
  "teal",
  "olive",
  "lime",
  "aqua",
  "cyan",
  "magenta",
  "maroon",
  "fuchsia",
  "pink",
  "brown",
  "beige",
  "ivory",
  "gold",
  "coral",
  "salmon",
  "khaki",
  "indigo",
  "violet",
  "turquoise",
  "tan",
  "plum",
  "orchid",
  "crimson",
  "lavender",
  "slategray",
  "slategrey",
  "darkgray",
  "darkgrey",
  "lightgray",
  "lightgrey",
  "dimgray",
  "dimgrey",
]);

/**
 * A strict CSS colour value: a hex triplet/quad, a bare keyword, or one numeric colour function
 * with plain numeric components (an optional `/ alpha`). Rejects escapes, comments, control
 * characters, nesting, `var()`, and every URL-bearing form.
 */
export function isValidColour(value: string): boolean {
  // Escapes and control characters are how a denylist gets bypassed: refuse them outright.
  if (UNSAFE_CHARS.test(value)) return false;
  if (value.includes("/*") || value.includes("*/")) return false;
  if (HEX.test(value)) return true;
  const lower = value.toLowerCase();
  if (COLOUR_KEYWORDS.has(lower)) return true;
  const fn = /^([a-z]+)\(([^()]*)\)$/i.exec(value);
  if (!fn) return false;
  if (!COLOUR_FUNCTIONS.has(fn[1]!.toLowerCase())) return false;
  // Components separated by commas, whitespace, or a single `/` before alpha. No nested functions
  // (the character class above excludes parentheses entirely).
  const parts = fn[2]!
    .split(/[\s,/]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return false;
  return parts.every((p) => COMPONENT.test(p));
}

/**
 * A conservative font-family list: comma-separated family names, each either a quoted string or
 * bare identifiers. No escapes, no functions, no URL-like forms, no control characters.
 */
export function isValidFontFamily(value: string): boolean {
  if (UNSAFE_CHARS.test(value)) return false;
  if (/[(){};:@]/.test(value)) return false;
  if (value.includes("/*") || value.includes("*/")) return false;
  const families = value.split(",").map((f) => f.trim());
  if (!families.length || families.some((f) => !f)) return false;
  return families.every((f) => {
    // A quoted family name: no embedded quote of the same kind.
    if (/^"[^"]+"$/.test(f) || /^'[^']+'$/.test(f)) return true;
    // Bare identifiers: letters, digits, hyphens, spaces between words.
    return /^[a-z0-9-]+(?: +[a-z0-9-]+)*$/i.test(f);
  });
}

/**
 * Parse the URL fragment. Returns null unless it starts with `embed` (so `#harness` and the
 * fragment-less MCP resource path are untouched). Flags follow as a query string:
 * `#embed&titled=true&theme=dark&audiences=viewer,author`.
 */
export function parseEmbedFragment(hash: string): EmbedConfig | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw !== "embed" && !raw.startsWith("embed&") && !raw.startsWith("embed?")) return null;
  const params = new URLSearchParams(raw.slice("embed".length).replace(/^[&?]/, ""));
  const theme = params.get("theme");
  return {
    titled: params.has("titled") ? isTruthyFlag(params.get("titled")) : false,
    theme: theme === "light" || theme === "dark" ? theme : undefined,
    audiences: parseAudiences(params),
  };
}

/**
 * `audiences=viewer,author` / `all` / `none`. Unrecognized values fall back to the default rather
 * than blanking the captions. The older boolean `notes` flag still turns them all off.
 */
function parseAudiences(params: URLSearchParams): DecisionAudience[] {
  const raw = params.get("audiences");
  if (raw !== null) {
    const tokens = raw
      .toLowerCase()
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.includes("none")) return [];
    if (tokens.includes("all")) return [...ALL_AUDIENCES];
    const picked = ALL_AUDIENCES.filter((a) => tokens.includes(a));
    if (picked.length) return picked;
  }
  if (params.has("notes") && !isTruthyFlag(params.get("notes"))) return [];
  return ["viewer"];
}

const isTruthyFlag = (v: string | null) => v === null || v === "" || v === "true" || v === "1";

/**
 * Keep only tokens we own whose value satisfies that token's property grammar. Validation is by
 * grammar rather than a forbidden-substring list, so CSS escapes (`u\72l(...)`), `image-set()`,
 * comments, and `var()` indirection cannot smuggle a network-loading value through.
 */
export function sanitizeTokens(input: unknown): EmbedTokens {
  const out: EmbedTokens = {};
  if (!input || typeof input !== "object") return out;
  for (const key of Object.keys(TOKEN_PROPERTY) as (keyof EmbedTokens)[]) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > TOKEN_MAX_LENGTH) continue;
    const ok = key === "fontFamily" ? isValidFontFamily(trimmed) : isValidColour(trimmed);
    if (ok) out[key] = trimmed;
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

/** Whether a payload sizes to its own content or fills the container the consumer gave it. */
export type EmbedSizing = "fill" | "content";

/**
 * Content-height reporter, following the iframe-resizer convention: the child measures and posts,
 * the consumer opts in by listening. Coalesced to one message per animation frame and suppressed
 * when the measurement is unchanged.
 *
 * Only ever driven in `content` sizing mode. A fill payload's height is whatever the parent set,
 * so measuring it would report the parent's own value back and close a feedback loop.
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

  /** Stop observing and forget the last measurement, so a restart reports afresh. */
  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
    this.frame = null;
    this.lastHeight = -1;
    this.lastWidth = -1;
  }
}
