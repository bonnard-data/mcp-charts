# Embed mode

Embed mode renders one chart, KPI, or table with no chrome of its own, so you can place it in a layout
you already own.

By default the widget draws a whole host surface: a grid, cell borders, fixed chart heights, and its
own titles. That suits an MCP host, where the widget owns the viewport. In your admin console the
widget is one tile among many, and all of that becomes something to crop around.

Embed mode is opt-in via a URL fragment, so the MCP path is unchanged and a server that never sets it
behaves exactly as before.

## Quickstart

Serve the widget from your own route. `WIDGET_HTML` is the same single self-contained file the MCP
resource serves.

```ts
import { WIDGET_HTML } from "@bonnard/mcp-charts";

app.get("/chart-widget", (_req, res) => res.type("html").send(WIDGET_HTML));
```

The protocol types ship with the package, so you do not have to copy them out of this page:

```ts
import type {
  BonnardRenderMessage,
  BonnardWidgetMessage,
  BonnardErrorCode,
  EmbedTokens,
  EmbedPayload,
} from "@bonnard/mcp-charts";
import { EMBED_PROTOCOL_VERSION, EMBED_LIMITS } from "@bonnard/mcp-charts";
```

Embed one cell. The container decides the size; `sandbox="allow-scripts"` is all the widget needs.

```html
<div class="my-card" style="height: 260px">
  <iframe id="rev" src="/chart-widget#embed" sandbox="allow-scripts" style="width: 100%; height: 100%; border: 0"></iframe>
</div>

<script>
  const frame = document.getElementById("rev");
  const spec = /* a ChartSpec, DashboardSpec, or DashboardItem */;

  window.addEventListener("message", (e) => {
    // The frame is opaque-origin, so event.source is the only identity you have. Always check it.
    if (e.source !== frame.contentWindow) return;

    if (e.data?.type === "bonnard:ready") {
      frame.contentWindow.postMessage({ type: "bonnard:render", payload: spec, theme: "light" }, "*");
    }
    if (e.data?.type === "bonnard:size") {
      frame.style.height = e.data.height + "px"; // content-height kinds: KPI, text, table
    }
    if (e.data?.type === "bonnard:error") {
      console.warn("chart render refused:", e.data.code, e.data.message);
    }
  });
</script>
```

Wait for `bonnard:ready` before posting. The widget emits it on every load, so a frame that reloads
(a DOM move reloads an iframe) asks you for the payload again instead of going blank.

## Fragment flags

Flags are static per instance, so they belong on the URL rather than in every message. Everything
after `#embed` parses as a query string.

```
/chart-widget#embed
/chart-widget#embed&titled=true&theme=dark&notes=false
```

| Flag     | Values          | Default | Effect                                                                        |
| -------- | --------------- | ------- | ----------------------------------------------------------------------------- |
| `titled` | `true`, `false` | `false` | Draw the widget's own title. Off by default, since you usually draw a header.  |
| `theme`  | `light`, `dark` | host    | Force a theme. Otherwise the widget follows the host or OS preference.         |
| `notes`  | `true`, `false` | `true`  | Draw guardrail advisories ("Showing the top 30 of 1000...").                   |

A bare flag reads as on: `#embed&titled` is `titled=true`. Unknown flags and unknown values are
ignored, so a newer consumer URL is safe against an older widget.

Leave `notes` on unless you surface the advisories yourself. They carry the reasons a chart looks the
way it does: coerced columns, capped categories, an empty result. Hiding them hides a data problem.

## Messages

### Parent to widget

```ts
{
  type: "bonnard:render",
  payload: ChartSpec | DashboardSpec | DashboardItem,
  itemId?: string,                  // with a DashboardSpec payload: render only the item with this id
  item?: number,                    // the same, by array index
  theme?: "light" | "dark",
  tokens?: EmbedTokens,
  renderId?: string,                // echoed back on bonnard:error
}
```

`payload` accepts three shapes:

- **`ChartSpec`** or a **bare `DashboardItem`** (a `KpiTile`, `TextBlock`, or chart cell) renders one
  chrome-less cell. This is the usual case.
- **`DashboardSpec` with `itemId` or `item: n`** renders only that cell, chrome-less. Post the spec you
  already have and address the cell you want, instead of taking the spec apart yourself. Prefer
  `itemId`: an id is stable, an array index moves when the dashboard changes.
- **`DashboardSpec` without a selector** renders the grid inside your container, with the outer padding
  and the dashboard title dropped.

Selection **fails closed**. A negative, non-integer, wrong-typed, or out-of-range selector, or an
`itemId` that matches nothing, returns `bonnard:error` and draws nothing. It does not fall back to the
whole grid, which would spill other cells into your layout.

### Widget to parent

```ts
{ type: "bonnard:ready", protocolVersion: 1 }
{ type: "bonnard:size", height: number, width: number, sizing: "content" }
{ type: "bonnard:error", code: BonnardErrorCode, message: string, renderId?: string }
```

`bonnard:ready` fires on every load, in the same turn as the first paint: embed mode runs no
handshake and waits on nothing, so it does not depend on your page answering anything first.
`protocolVersion` is currently `1`; check it if you need to detect a consumer running an older
installed version of the package.

`bonnard:error` means the render was refused and nothing was drawn; whatever was on screen before
stays. `code` is one of `invalid-payload`, `payload-too-large`, `item-not-found`,
`invalid-item-selector`, or `render-failed`. Set `renderId` on your render message to correlate it.

Payloads are validated with bounds (see `EMBED_LIMITS`): rows, items, series/columns, string lengths,
notes, and nesting depth. A payload past any bound is refused whole rather than truncated.

## Sizing

Charts and intrinsic cells size differently, so embed mode handles them differently, and it tells you
which one you have.

**Charts fill their container.** A chart has no intrinsic height, so you decide: give the iframe a
height and the chart takes all of it at 1:1, with no scaling. If you forget to size the container, a
240px minimum keeps the chart visible instead of collapsing it to nothing. A fill chart sends **no**
`bonnard:size` message at all, so there is nothing to feed back.

**KPI, text, and table cells are content-height** and report their measurement:

```js
if (e.data?.type === "bonnard:size") frame.style.height = e.data.height + "px";
```

Every size message carries `sizing: "content"`, so you can apply it unconditionally.

This follows the iframe-resizer convention: the child measures and posts, you opt in by listening. It
works from an opaque origin because the measurement happens inside the frame; you never need
`allow-same-origin`.

Reports fire after the first paint, after every re-render, and whenever a `ResizeObserver` on the
content sees a change (fonts loading, text rewrapping). They are coalesced to one message per
animation frame and suppressed when the measurement has not changed, so a stable cell goes quiet.

**Why applying every report is safe.** Only content-height payloads report, and in content mode
`html`, `body`, and `#root` stay at `height: auto`. The measurement therefore depends on the content,
never on the height you just wrote back, so there is no loop to converge: the value you apply cannot
change the next measurement. Fill charts, whose height *is* whatever you set, report nothing at all.
This is covered by a browser test that applies every reported height and asserts the report count
stops (wrapped text and scrollbar cases included).

## Theme tokens

`theme: "light" | "dark"` drives both the widget CSS and the chart palette. For anything past that,
pass a bounded set of tokens to match your own design system:

```ts
interface EmbedTokens {
  bg?: string; // page background
  fg?: string; // body text
  muted?: string; // labels, captions, notes
  border?: string; // table rules, cell borders
  fontFamily?: string; // the HTML surface only, not chart text
}
```

```js
frame.contentWindow.postMessage(
  {
    type: "bonnard:render",
    payload: spec,
    theme: "light",
    tokens: { bg: "#fffdf7", fg: "#1c1917", muted: "#78716c", fontFamily: "Inter, system-ui, sans-serif" },
  },
  "*",
);
```

### What tokens do and do not theme

Tokens theme the **HTML surface**: the page background, body text, table rules and headers, KPI tiles,
text blocks, and notes.

Tokens do **not** theme chart internals. ECharts axes, gridlines, legend, tooltip, series palette, and
chart text follow `theme: "light" | "dark"` and are otherwise fixed. Chart theming means reaching into
the charting library's theme internals and reinitialising every instance, which is a larger change
than this token set; it is a candidate for a future minor, not something this list implies today.

If you need branded chart colours now, the honest answer is that embed mode cannot do it yet.

### Validation

Tokens are set as CSS custom properties, never injected as CSS text, and each is validated against
the grammar for its own property rather than a list of banned substrings:

- **Colour tokens** (`bg`, `fg`, `muted`, `border`) must be a hex colour (`#fff`, `#ffffff`,
  `#ffffffaa`), one of a short list of CSS colour keywords, or a numeric colour function
  (`rgb()`, `rgba()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`) with plain numeric
  components. `bg` is applied as `background-color`, so it can only ever be a colour.
- **`fontFamily`** must be a comma-separated list of quoted strings or bare identifiers.
- Anything else is dropped: `url()` in any spelling (including escaped forms such as `u\72l(...)`),
  `image-set()`, gradients, `var()`, `attr()`, `expression()`, `@import`, comments, backslash escapes,
  control characters and newlines, and anything over 120 characters.

Invalid tokens are dropped silently and individually: the rest of the object still applies. Omitting a
token you previously set clears it back to the theme default.

### Theme precedence

Highest wins:

1. The most recent valid `theme` on a `bonnard:render` message. This is a persistent explicit
   override: once set, a later host or OS change will not revert it.
2. The `theme` flag on the `#embed` fragment, which is the initial theme.
3. The host or OS preference, used only when neither of the above is present.

## Security

The posture is the same one the MCP path ships with, and embed mode does not relax it.

- **`sandbox="allow-scripts"` is sufficient.** Nothing in embed mode needs `allow-same-origin`,
  `allow-popups`, `allow-forms`, or `allow-top-navigation`. Do not add them.
- **The widget makes no network requests of its own.** It is one self-contained file with the chart
  library inlined, and it ships a restrictive `Content-Security-Policy` that denies every fetching
  directive as defence in depth. Token validation is what keeps a caller-supplied value from becoming
  a `url()` and turning into a request; validating by property grammar rather than by denylist is why
  escaped spellings cannot get through.
- **Every payload string is escaped** before it reaches the DOM. Specs are agent-generated and
  tenant-derived, so a renderer bug stays inside the sandbox. That containment is why the widget is an
  iframe rather than a web component.
- **The widget authenticates you.** It only accepts messages whose `event.source` is its own parent
  window. It cannot check your *origin* from an opaque frame (there is no useful origin string to
  compare), but sender identity needs no `allow-same-origin`, and this stops any other window that
  holds the frame's `WindowProxy` from replacing its content or applying hostile tokens.
- **Check `event.source` on your side too.** Compare it against your iframe's `contentWindow` before
  trusting a message, as the example above does.
- **Payloads are bounded.** Rows, items, series, columns, string lengths, notes, and nesting depth are
  all capped (`EMBED_LIMITS`), so one malformed or oversized message is refused with `bonnard:error`
  rather than stalling the frame.

## Stability contract

### Public and semver-governed

- The `#embed` fragment and its flags: `titled`, `theme`, `notes`.
- The message types `bonnard:render`, `bonnard:ready`, `bonnard:size`, `bonnard:error`, and their
  documented fields.
- The `EmbedTokens` keys, and the exported types (`BonnardRenderMessage`, `BonnardWidgetMessage`,
  `BonnardErrorCode`, `EmbedPayload`) plus `EMBED_PROTOCOL_VERSION`.
- Which payload kinds report `bonnard:size` (content) and which report nothing (fill charts).
- Selection failing closed: an unusable `item` / `itemId` is an error, not a whole-grid fallback.
- The `ChartSpec`, `DashboardSpec`, and `DashboardItem` payload shapes.

### Explicitly not API

- Internal CSS class names and DOM structure. The iframe boundary means you cannot style widget
  internals from outside, which is deliberate.
- Pixel constants (the 240px minimum, grid gaps, font sizes).
- The exact values in `EMBED_LIMITS`. They are documented and exported, but may be raised or lowered.
- Which properties chart theming will eventually cover. Charts are not token-themed today.
- The `#harness` fragment and the `bonnard:harness-*` messages. Those are the dev-only cousin of embed
  mode (see [DEV-HARNESS.md](./DEV-HARNESS.md)) and may change without notice.

### What upgrading does

Within a major line, flags and message fields are only added, never removed or re-typed. Unknown flags
and fields are ignored on both sides, so a new consumer against an old widget degrades rather than
breaks.

You serve `WIDGET_HTML` from your own installed copy of the package, so an existing embed changes only
when you upgrade. Upgrading within `0.x` keeps this contract. Any breaking change to it comes with a
major-line bump and a changelog entry naming it. We will not drop a flag silently.

## Runnable example

`examples/embed/` is a two-card page: a fill-sized chart and a content-sized cell that resizes itself
from `bonnard:size`, with pickers for the payload kind, theme, and tokens (including an invalid token
set, to watch validation drop it).

```bash
pnpm build
python3 -m http.server 8000   # from the repo root
# open http://localhost:8000/examples/embed/
```

## Known gaps

Deliberately not addressed yet, recorded so they are not mistaken for oversights:

- **Chart theming.** Tokens do not reach ECharts (axes, gridlines, legend, tooltip, series palette,
  chart text). Only `theme: "light" | "dark"` does. A future minor may add it.
- **`notes=garbage` disables notes** instead of keeping the default. Fragment flags parse loosely:
  anything that is not a truthy spelling reads as off. Pass `notes=true`/`notes=false` explicitly.
- **Fragment parsing details are unspecified**: duplicate-key precedence, case sensitivity, and
  whether percent-encoded markers are supported. Use the documented spellings.
- **The 240px minimum cannot force an unsized iframe taller.** A child cannot change its own frame's
  viewport, so if you leave the iframe unsized the browser default applies and a chart may scroll.
  Give the iframe a height.
- **`protocolVersion` is informational.** There is no per-message version, capability negotiation,
  acknowledgement, or request/response pairing beyond `renderId` on errors. How a v2 would coexist is
  not defined yet.
