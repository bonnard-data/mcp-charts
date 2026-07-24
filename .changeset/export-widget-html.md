---
"@bonnard/mcp-charts": patch
---

Export `WIDGET_HTML`, `WIDGET_META`, and `VIEW_OUTPUT_SCHEMA` from the package root. A downstream host can now serve the same widget renderer directly (not only through the MCP resource) and reuse the widget-linking `_meta` and output schema without maintaining its own copies.
