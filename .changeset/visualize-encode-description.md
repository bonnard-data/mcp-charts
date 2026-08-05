---
"@bonnard/mcp-charts": patch
---

`presentationInput`'s `encode` parameter (used by the `visualize` MCP tool and by any caller building a chart spec) had a description that didn't say when it actually matters: "Map columns to x / y / series / y2 when names aren't obvious" — framed as a naming-ambiguity fallback, when the real trigger is column *type*, not naming. It's rewritten to explain the actual failure mode (an all-numeric result where the aggregate is listed before its grouping column) and give a concrete example, so a calling agent has a chance of setting `encode.x` correctly without needing to already know how the auto-detection heuristic works.
