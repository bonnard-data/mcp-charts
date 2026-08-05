---
"@bonnard/mcp-charts": patch
---

Fixed dashboard text tiles and guardrail notes (`.text-body`, `.cell-notes`, `.dash-notes`) spilling
past their cell when they contained a long unbreakable token (a raw column name, a URL) — the same
class of bug as the earlier KPI-tile overflow fix, but these three never got the `overflow-wrap`
rule. In the worst case this also pushed the whole dashboard grid past its frame, since a track
sized with `minmax(0, 1fr)` can't protect against a child whose content refuses to wrap.

<!-- skip-gh-release -->
