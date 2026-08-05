---
"@bonnard/mcp-charts": minor
---

New `xAxisType` option on `resolve()` forces a numeric x-axis to be read as `"categorical"` or `"continuous"`, overriding inference. A `GROUP BY year` produces a numeric column that is really a set of buckets, and charting it on a linear scale spreads three years across a decade of empty axis; `xAxisType: "categorical"` plots them as evenly-spaced labels instead. Unset, inference is unchanged.

A genuinely continuous numeric x-axis (line and scatter) now fits its own data range rather than being forced through zero, so a range like 2017-2026 no longer collapses into a sliver at the end of a 0-2500 axis.
