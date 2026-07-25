// The embed-mode wire contract, owned by the public package so TypeScript consumers can import the
// message types instead of hand-copying them out of the docs.
//
// Types only (plus the protocol constant and the caps): the implementation lives in the widget,
// which is what actually runs inside the iframe.
import type { ChartSpec, DashboardItem, DashboardSpec } from "./types.js";

/**
 * Bounded theme tokens for the embedded widget, applied as CSS custom properties.
 *
 * Colour tokens must satisfy a strict colour grammar (hex, a short set of named colours, or one
 * numeric colour function such as `rgb()` / `oklch()`); `fontFamily` a conservative font-list
 * grammar. Anything else is dropped silently, and the rest of the object still applies.
 *
 * These theme the HTML surface only: the page background, body text, table rules, tiles, and
 * notes. Chart internals (ECharts axis, gridlines, legend, tooltip, series palette, and chart
 * text) are NOT themed by tokens; they follow `theme: "light" | "dark"`.
 */
export interface EmbedTokens {
  /** Page background. Applied as `background-color`. */
  bg?: string;
  /** Body text colour. */
  fg?: string;
  /** Labels, captions, and notes. */
  muted?: string;
  /** Table rules and cell borders. */
  border?: string;
  /** Font stack for the HTML surface. Not applied to chart text. */
  fontFamily?: string;
}

/** A payload the embedded widget can render. */
export type EmbedPayload = ChartSpec | DashboardSpec | DashboardItem;

/** Parent to widget: render this payload. */
export interface BonnardRenderMessage {
  type: "bonnard:render";
  payload: EmbedPayload;
  /**
   * With a `DashboardSpec` payload: render only `items[item]`, chrome-less. Fails closed with a
   * `bonnard:error` when the index is negative, non-integer, or out of range.
   */
  item?: number;
  /** With a `DashboardSpec` payload: render only the item whose `id` matches. Preferred over `item`. */
  itemId?: string;
  /** Becomes a persistent explicit theme override for the life of the frame. */
  theme?: "light" | "dark";
  tokens?: EmbedTokens;
  /** Echoed back on `bonnard:error`, so a failure can be correlated with its request. */
  renderId?: string;
}

/** Widget to parent: the frame is loaded and ready for a `bonnard:render`. */
export interface BonnardReadyMessage {
  type: "bonnard:ready";
  protocolVersion: number;
}

/**
 * Widget to parent: the measured content height. Only sent for content-sizing payloads (KPI, text,
 * table, empty state, fallback). A fill-sizing chart never reports a size, because its height is
 * whatever the parent set.
 */
export interface BonnardSizeMessage {
  type: "bonnard:size";
  height: number;
  width: number;
  sizing: "content";
}

/** Why a render was refused. Stable strings, safe to branch on. */
export type BonnardErrorCode =
  | "invalid-payload"
  | "payload-too-large"
  | "item-not-found"
  | "invalid-item-selector"
  | "render-failed";

/** Widget to parent: the render was refused, and nothing was drawn. */
export interface BonnardErrorMessage {
  type: "bonnard:error";
  code: BonnardErrorCode;
  message: string;
  renderId?: string;
}

/** Every message the widget can send its parent in embed mode. */
export type BonnardWidgetMessage = BonnardReadyMessage | BonnardSizeMessage | BonnardErrorMessage;

/** Every message a parent can send the widget in embed mode. */
export type BonnardParentMessage = BonnardRenderMessage;

/** Bumped when the message contract changes shape. Carried on `bonnard:ready`. */
export const EMBED_PROTOCOL_VERSION = 1;

/**
 * Bounds the widget enforces on a render payload. Exceeding any of them is refused whole, with a
 * `payload-too-large` error, rather than truncated.
 */
export const EMBED_LIMITS = {
  /** Rows in a single `ChartSpec.data`. */
  maxRows: 20_000,
  /** Items in a `DashboardSpec`. */
  maxItems: 100,
  /** Series in one chart, and columns in one table. */
  maxSeries: 64,
  /** Keys on a single data row. */
  maxRowKeys: 128,
  /** Any single string in a payload. */
  maxStringLength: 10_000,
  /** Notes entries on a chart or dashboard. */
  maxNotes: 50,
  /** Total values walked while validating, as a stall guard. */
  maxNodes: 200_000,
} as const;
