---
"@bonnard/mcp-charts": patch
---

Fix table tiles overflowing their cell instead of scrolling. A table with more rows than fit now scrolls internally with a sticky header instead of growing the card unbounded; a table wider than its cell scrolls horizontally instead of clipping at the edge. Also stop short cells (a small table, a KPI) from being stretched to match a taller chart neighbor in the same grid row.
