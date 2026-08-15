---
"@bonnard/mcp-charts": patch
---

`resolve()`'s advisories are now structured `Decision`s (`{ kind, audiences, message, data? }`) alongside the existing flat `notes: string[]`, which is unchanged in shape and content — every existing message carries the exact same wording as before, just built from one central table instead of scattered inline strings. `audiences` says who a decision is for: `viewer` (a presentational caption), `author` (a config mistake in the view itself), or `agent` (a data-trust signal for whatever called the tool). A rendered chart widget now captions only `viewer`-audience decisions by default, instead of showing every advisory to whoever's looking at the chart. A spec built before this change (no `decisions` array) falls back to showing its flat `notes` whole, so nothing existing changes behavior.
