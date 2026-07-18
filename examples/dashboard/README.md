# Dashboard: a multi-chart dashboard from one MCP tool

Return a [`DashboardSpec`](../../packages/core/src/types.ts) from an MCP tool and the embedded widget
renders a multi-chart dashboard (KPIs + charts + text) in one `ui://` view. This example serves MCP
over **Streamable HTTP** so you can connect a remote MCP client (Claude Desktop, Cursor, or the
Inspector) at `http://localhost:3000/mcp`, with no auth.

The `sales_dashboard` tool has no database: it composes a `DashboardSpec` from small in-memory arrays.
Its chart cells are built through the library's own path (`buildChartData` + `resolve`), exactly like
[`packages/core/src/fixtures/dashboards.ts`](../../packages/core/src/fixtures/dashboards.ts), so it
exercises the real composition path rather than hand-authored specs. For the ad-hoc `visualize` (SQL
-> single chart) path, see [`examples/quickstart`](../quickstart).

## Run

```bash
# from the repo ROOT (builds core + widget so the workspace:* dist has the DashboardSpec exports)
pnpm install
pnpm build

# then, in this directory:
pnpm start            # listens on http://localhost:3000/mcp  (set PORT to change)
```

## MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

In the Inspector: set **Transport Type** to **Streamable HTTP**, **URL** to `http://localhost:3000/mcp`,
click **Connect**, then call **`sales_dashboard`**. Confirm the widget renders the grid (two KPIs, a
line chart, a bar chart, a text block) and that `structuredContent.items` holds the raw dashboard items.
Try `{ "region": "EU" }` to see the numbers change.

## Claude Desktop (Streamable HTTP via a tunnel, no auth)

Claude Desktop remote connectors need a public HTTPS URL, so expose the local server with a tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

That prints a public `https://<name>.trycloudflare.com` URL. In Claude Desktop, add a **custom
connector** pointing at `https://<name>.trycloudflare.com/mcp` (no auth), then prompt
*"show me the sales dashboard"*.

The tunnel is required here only because a remote connector needs a public HTTPS URL. There is still
**no OAuth / no auth** and **no npm publish** (the server runs the local `workspace:*` build). If a
given Claude Desktop build does not render MCP-Apps widgets, use the Inspector above to see the visual.

## How it works

The tool returns `structuredContent` = a `DashboardSpec` (a `{ items }` grid of KPI tiles, chart
cells, and text blocks), and binds it to the widget via `_meta.ui.resourceUri` (with the
`openai/outputTemplate` alias for the ChatGPT Apps SDK). One cacheable `ui://bonnard/chart` resource
serves the widget; it discriminates a `DashboardSpec` (`items`) from a single `ChartSpec` (`data`) and
renders any dashboard as a grid. A loose `outputSchema` (permissive records) declares the envelope so
hosts that gate `structuredContent` on a schema still forward it, without ever rejecting a valid spec.
