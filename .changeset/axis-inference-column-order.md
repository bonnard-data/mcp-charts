---
"@bonnard/mcp-charts": patch
---

When a chart result has two or more numeric columns and no explicit `encode.x`, `resolve()` used to guess the x-axis by picking the column with the *fewest* distinct values. That inverts on the common `SELECT <group_col>, COUNT(*)/SUM(...) ... GROUP BY <group_col>` shape whenever two aggregate values coincidentally tie, ranking the measure above its own grouping column and producing a fabricated axis. It now promotes the first non-constant column instead, matching the column order a `GROUP BY` query already returns.
