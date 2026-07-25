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
  item?: number,                    // with a DashboardSpec payload: render only items[item]
  theme?: "light" | "dark",
  tokens?: EmbedTokens,
}
```

`payload` accepts three shapes:

- **`ChartSpec`** or a **bare `DashboardItem`** (a `KpiTile`, `TextBlock`, or chart cell) renders one
  chrome-less cell. This is the usual case.
- **`DashboardSpec` with `item: n`** renders only `items[n]`, chrome-less. Post the spec you already
  have and address the cell you want, instead of taking the spec apart yourself.
- **`DashboardSpec` without `item`** renders the grid inside your container, with the outer padding and
  the dashboard title dropped.

An out-of-range `item` falls back to the whole grid.

### Widget to parent

```ts
{ type: "bonnard:ready", protocolVersion: 1 }
{ type: "bonnard:size", height: number, width: number }
```

`bonnard:ready` fires on every load. `protocolVersion` is currently `1`; check it if you need to
detect a consumer running an older installed version of the package.

## Sizing

Charts and intrinsic cells size differently, so embed mode handles them differently.

**Charts fill their container.** A chart has no intrinsic height, so you decide: give the iframe a
height and the chart takes all of it at 1:1, with no scaling. If you forget to size the container, a
240px minimum keeps the chart visible instead of collapsing it to nothing.

**KPI, text, and table cells are content-height** and report their measurement:

```js
if (e.data?.type === "bonnard:size") frame.style.height = e.data.height + "px";
```

This follows the iframe-resizer convention: the child measures and posts, you opt in by listening. It
works from an opaque origin because the measurement happens inside the frame; you never need
`allow-same-origin`.

Reports fire after the first paint, after every re-render, and whenever a `ResizeObserver` on the
content sees a change (fonts loading, text rewrapping). They are coalesced to one message per
animation frame and suppressed when the measurement has not changed, so a stable cell goes quiet.

For a fill-container chart the report just echoes the container you set, and you can ignore it.

## Theme tokens

`theme: "light" | "dark"` drives both the widget CSS and the chart palette. For anything past that,
pass a bounded set of tokens to match your own design system:

```ts
interface EmbedTokens {
  bg?: string; // page background
  fg?: string; // body text
  muted?: string; // labels, captions, notes
  grid?: string; // chart gridlines
  border?: string; // table rules, cell borders
  fontFamily?: string;
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

Tokens are set as CSS custom properties, never injected as CSS text. Anything outside the list above
is dropped, as is any value that is not a string, is over 120 characters, or contains `;`, `{`, `}`,
`url(`, `@import`, or `expression(`. Invalid tokens are ignored silently; the rest of the object still
applies. Omitting a token you previously set clears it back to the theme default.

There is no series colour palette token yet. Setting series colours means reaching into the chart
library's theme internals, which is a larger change than the tokens above.

## Security

The posture is the same one the MCP path ships with, and embed mode does not relax it.

- **`sandbox="allow-scripts"` is sufficient.** Nothing in embed mode needs `allow-same-origin`,
  `allow-popups`, `allow-forms`, or `allow-top-navigation`. Do not add them.
- **The widget makes no network requests.** It is one self-contained file with the chart library
  inlined.
- **Every payload string is escaped** before it reaches the DOM. Specs are agent-generated and
  tenant-derived, so a renderer bug stays inside the sandbox. That containment is why the widget is an
  iframe rather than a web component.
- **Check `event.source`.** The widget cannot verify your origin from an opaque frame and does not
  try; it is render-only. On your side, compare `event.source` against your iframe's `contentWindow`
  before trusting a message, as the example above does.

## Stability contract

### Public and semver-governed

- The `#embed` fragment and its flags: `titled`, `theme`, `notes`.
- The message types `bonnard:render`, `bonnard:ready`, `bonnard:size`, and their documented fields.
- The `EmbedTokens` keys.
- The `ChartSpec`, `DashboardSpec`, and `DashboardItem` payload shapes.

### Explicitly not API

- Internal CSS class names and DOM structure. The iframe boundary means you cannot style widget
  internals from outside, which is deliberate.
- Pixel constants (the 240px minimum, grid gaps, font sizes).
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
