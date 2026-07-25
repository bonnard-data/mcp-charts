---
"@bonnard/mcp-charts": minor
---

Add embed mode: render a single chart, KPI, or table inside your own UI, not only inside an MCP host.

Point an iframe at `WIDGET_HTML` with an `#embed` fragment, then post a `bonnard:render` message carrying a `ChartSpec`, a bare `DashboardItem`, or a `DashboardSpec` with `item: n` to select one cell. Embed mode drops the widget's own padding, cell chrome, and title. Charts fill the container you give them; KPI, text, and table cells report their content height over `bonnard:size` so you can fit the frame to them. Presentation flags (`titled`, `theme`, `notes`) ride on the fragment, and theming goes through a bounded, validated token set rather than CSS overrides.

Purely additive. The MCP resource path and every existing message behave identically, `sandbox="allow-scripts"` is still all the widget needs, and nothing changes for a consumer that does not opt in. See `docs/EMBED-MODE.md` for the flags, messages, tokens, and the stability contract.
