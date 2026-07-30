---
"@bonnard/mcp-charts": patch
---

Remove the `newRow` tile-placement marker. Its CSS rule collided with a tile's `span`: `grid-column: span N` shorthand lives in `grid-column-start`, so `newRow`'s `grid-column-start: 1` clobbered the span instead of composing with it, collapsing any tile combining `span` and `newRow` to 1-column width.
