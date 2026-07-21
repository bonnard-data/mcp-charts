---
"@bonnard/mcp-charts": minor
---

`mcp-charts preview` CLI: render your specs in the real chart widget locally

The package now ships a `mcp-charts` bin, so `npx @bonnard/mcp-charts preview` renders a spec in the
same embedded widget a host uses, before you wire it into a server.

- **Spec-file mode.** `mcp-charts preview ./chart.json --watch` loads a saved `ChartSpec` or
  `DashboardSpec` (for example a tool's `structuredContent`), validates it with the widget's own
  guards, and renders it, re-rendering on save.
- **MCP mode.** `mcp-charts preview --mcp <url> --tool <name> --args '<json>'` calls a tool on your
  running Streamable HTTP server and renders the spec it returns, with a re-run affordance. `--mcp`
  accepts a bare origin (`/mcp` is appended) or a full endpoint URL.
- Flags: `--port`, `--theme light|dark`, and `--no-open`.

The runtime path uses Node built-ins only, and the bin is a separate build entry, so importing the
library is unaffected.
