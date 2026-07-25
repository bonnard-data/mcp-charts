---
"@bonnard/mcp-charts": patch
---

Fix embed mode: loop-safe sizing, real token validation, and a contract that fails closed.

Two independent reviews of the 0.3.0 embed surface found problems worth fixing before the API
hardens into a semver obligation. Nothing here changes the MCP host path.

**Embed mode no longer starts the MCP Apps bridge.** In `#embed` the widget previously still
constructed the ext-apps `App` and posted a `ui/initialize` request to the parent. An embedding page
does not answer that, and a page that *did* answer it got a second, undocumented resize protocol
competing with `bonnard:size`. Embed setup is now fully synchronous and self-contained: the
`data-embed` attribute, the first paint, and `bonnard:ready` all happen in one turn, sequenced behind
nothing. Outside embed mode the bridge behaves exactly as before.

**Sizing is now structurally loop-safe, and a fill chart can no longer be left collapsed.** The widget
tracks `sizing: "fill" | "content"` per payload, and every `bonnard:size` message carries that
discriminant.

- `sizing: "content"` (KPI, text, table, fallback) carries a measured `height` to apply.
- `sizing: "fill"` (charts) carries `height: null` and means *release any height you applied for this
  frame*, since only the parent can decide a chart's height. No measured height is ever reported for a
  fill payload, so there is no value to feed back.

In content mode `html`, `body`, and `#root` stay at `height: auto`, so a measurement cannot depend on
the height you just applied: there is no loop to converge.

The release message closes a collapse trap that 0.3.0's own documented handler walked straight into.
The pre-render "waiting for chart data" placeholder is content-shaped, so it reported roughly 48px; a
parent applying that shrank the frame; the fill chart then filled 48px permanently, because a fill
payload reported nothing and so never told the parent to let go. Two changes fix it: the widget stays
silent until a payload has actually rendered (the placeholder's height says nothing about the payload
to come), and entering fill mode is announced explicitly.

**Breaking-ish note for anyone who adopted 0.3.0's embed handler:** branch on `sizing` rather than
applying `height` unconditionally. The docs, README, and `examples/embed/` now all show the branching
form, and giving the frame its height from a sized container via a stylesheet rule (rather than an
inline style) is what lets a release fall back to your layout height. Applying `height` blindly is now
harmless rather than destructive, since the fill message's `height` is `null`, but it will not restore
the frame.

**Token validation is by property grammar, not a denylist.** The old check only rejected a literal
`url(`, but CSS function names accept escapes, so `u\72l(https://…)` slipped through and landed in
the broad `background` property, contradicting the "no network requests" claim. Colour tokens must now
satisfy a strict colour grammar (hex, a short keyword list, or a numeric colour function) and are
applied via `background-color`; `fontFamily` has a conservative font-list grammar. Escapes,
`image-set()`, gradients, `var()`, `attr()`, comments, control characters, and newlines are all
rejected. The widget also ships a restrictive `Content-Security-Policy` as defence in depth.

**The widget authenticates the sender.** Embed messages are only accepted when `event.source` is the
frame's own parent, which needs no `allow-same-origin`. The docs previously said the frame could not
verify the sender; it cannot verify your *origin*, but it can and now does verify identity.

**The two mode dialects are separate.** `#embed` accepts only `bonnard:render`, and `#harness` only
`bonnard:harness-render`. This restores the "harness unchanged" guarantee and stops the internal
dialect being reachable from the public surface.

**Payloads are validated with caps.** `{items:[null]}` used to throw, `{type:"text"}` rendered
"undefined", and `{data:[{}]}` passed as a chart. Payloads are now structurally validated with bounds
on rows, items, series/columns, string length, notes, and nesting depth (exported as `EMBED_LIMITS`).
A refusal returns a typed `bonnard:error` (`code`, `message`, and your `renderId`) instead of throwing
from the message listener, and leaves whatever was on screen intact. ECharts instances are recorded
before `setOption`, so a throw can no longer leak one.

**Cell selection fails closed, and accepts `itemId`.** A negative, non-integer, wrong-typed, or
out-of-range `item` used to fall back to rendering the whole dashboard, spilling other cells into the
caller's layout. Those now return `bonnard:error` and draw nothing. Items already carry stable ids, so
`itemId` is the preferred selector; the numeric index remains as a convenience.

**`titled=true` now works for every single-cell shape.** Previously only a top-level non-table
`ChartSpec` honoured it; a table, a bare chart cell, and a dashboard cell selected by `item` ignored
it. Single-cell title composition is centralized, and the title means the rendered cell's own chart
title.

**Theme precedence is defined.** The `#embed` fragment provides the initial theme; the most recent
valid `theme` on a render message becomes a persistent explicit override that a later host or OS
change will not revert; host and OS apply only when neither exists.

**The protocol surface is exported.** `EmbedTokens`, `EmbedPayload`, `EmbedSizing`,
`BonnardRenderMessage`, `BonnardReadyMessage`, `BonnardSizeMessage` (a union of
`BonnardContentSizeMessage` and `BonnardFillSizeMessage`), `BonnardErrorMessage`, `BonnardErrorCode`,
`BonnardWidgetMessage`, `BonnardParentMessage`, `EMBED_PROTOCOL_VERSION`, and `EMBED_LIMITS` now come
from `@bonnard/mcp-charts`, so TypeScript consumers stop hand-copying types out of the docs. Narrowing
`BonnardSizeMessage` on `sizing` gives you the right `height` type for free: `number` or `null`.

**What tokens actually theme, stated plainly.** Tokens theme the HTML surface only: page background,
body text, table rules, tiles, and notes. They do **not** theme ECharts axes, gridlines, legend,
tooltip, series palette, or chart text, which follow `theme: "light" | "dark"` and are otherwise
fixed. The public token surface is narrowed to what works: the `grid` token is removed, since no CSS
consumed it, and `fontFamily` is now a CSS custom property (`--font-family`) rather than a plain
property, matching the documented behaviour. Wiring chart theming is left as a documented future
addition rather than implied by the token list.

**Correcting the record on 0.3.0's "purely additive" claim.** That claim does not hold and is
withdrawn. 0.3.0 began clearing the widget's remembered payload after a fallback or invalid input on
every surface, not only in embed mode: before 0.3.0, a valid chart followed by a fallback would
repaint the *old* chart on a later theme change, whereas from 0.3.0 it keeps the fallback. That is a
reasonable fix and it is retained here, but it is observable outside embed mode and should have been
disclosed as a behaviour change rather than described as additive. 0.3.0 also let `#embed` accept the
internal `bonnard:harness-render` dialect and `#harness` accept `bonnard:render`; both are corrected
above.

Also: real browser integration tests now drive the built widget inside an opaque
`sandbox="allow-scripts"` iframe, covering ready timing and ordering, the `data-embed` activation,
source filtering, malformed payloads, theme precedence, token attacks, fill-versus-content sizing with
a convergence bound, the collapse sequence above (including under 0.3.0's naive handler), and the
inertness of the no-fragment and `#harness` paths. The previous suite only exercised the helpers, which
is why the issues above shipped.

One testing note, since it looks like a bug and is not: Chrome throttles `requestAnimationFrame` for
offscreen cross-origin iframes, and the size reporter is rAF-coalesced, so a frame scrolled out of view
may report no size at all until it becomes visible. Test embed sizing with the frame on screen.

Known gaps, documented in `docs/EMBED-MODE.md`: chart theming, `notes=garbage` reading as off,
unspecified fragment-parsing details (duplicate keys, case, percent-encoding), the 240px minimum being
unable to resize an unsized iframe, and `protocolVersion` not yet being load-bearing.
