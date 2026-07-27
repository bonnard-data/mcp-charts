---
"@bonnard/mcp-charts": patch
---

Bars stay vertical unless you ask for horizontal, and short frames no longer clip x-axis labels.

**Bar charts no longer flip themselves horizontal.** `resolve()` used to switch any categorical bar
chart with more than 8 rows to a horizontal layout. A row count is a poor stand-in for the thing that
actually makes a flip worthwhile, which is label width: the rule turned twelve `Q1`-sized labels
sideways while leaving five 40-character labels alone. It also sent a 12-month series sideways, which
is what prompted this change. Bars now default to vertical, matching Superset, Metabase, Lightdash and
Evidence, none of which infer orientation from row count.

`horizontal: true` is the explicit opt-in and works exactly as before, on both the `chart` tool schema
and a hand-written `ChartSpec`. The option now carries a description so a model calling the tool can
find it. A same-axis combo line still forces a vertical layout, since a connected line over horizontal
bars reads as a meaningless diagonal.

If you relied on the automatic flip, add `horizontal: true`. Saved specs are worth a look before you
upgrade: none of them recorded `horizontal: false`, because vertical was never something you had to
ask for, so any chart that used to flip now renders vertical. Long category labels are still handled
without a flip request. The widget keeps its own label-width rule, which flips a bar chart when the
labels themselves are too long to sit under vertical bars, and otherwise thins overlapping ticks so
the ones it draws stay readable.

**Fill-mode charts no longer clip their x-axis labels in a short frame.** The single-cell embed shapes
carried a `min-height: 240px` floor, so a frame shorter than that overflowed instead of shrinking and
the bottom row of tick labels was cut off. Measured in Chrome at a 654x228 frame, the chart held 240px
and the labels ran to 232.7px, past the edge. Without the floor the chart tracks the frame at 180px,
228px and 300px and the labels clear the bottom by 7px. An unsized iframe still has its 150px intrinsic
height, so nothing depended on the floor to stay visible. Dashboard grid cells keep their own 240px
minimum.
