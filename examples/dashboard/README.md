# Dashboard: a multi-view dashboard surface from one MCP server

This example registers a **multi-view** surface with
[`addDashboardViews`](../../packages/core/src/dashboard-tool.ts): two tools over a registry of named
views. `explore_views` lists what's available (id, title, description, params); `render_view` renders
one by `view_id` into the embedded `ui://` widget. Views mix single charts and composed dashboards
(KPIs + charts + text) across several chart types.

It serves MCP over **Streamable HTTP** so you can connect a remote MCP client (Claude Desktop, Cursor,
or the Inspector) at `http://localhost:3000/mcp`, with no auth.

There's no database here on purpose: each view composes its spec from small in-memory arrays. Single
charts are built with `chart(rows, opts)`; dashboard cells with `chartCell(rows, opts)`. Both infer
the encoding via `resolve()`. For the ad-hoc `visualize` (SQL → single chart) path, see
[`examples/quickstart`](../quickstart).

## The six views

| `view_id`           | kind      | params    | what it renders                                                        |
| ------------------- | --------- | --------- | ---------------------------------------------------------------------- |
| `sales_overview`    | dashboard | `region?` | KPIs + revenue-by-month line + revenue-by-region bar + a summary.      |
| `exec_summary`      | dashboard | —         | A KPI-forward exec view: revenue, orders, avg order value, + a trend.  |
| `revenue_trend`     | chart     | —         | A line chart of monthly revenue.                                       |
| `region_breakdown`  | chart     | —         | A pie chart of revenue by region.                                      |
| `order_funnel`      | chart     | —         | A funnel chart of orders by status.                                    |
| `department_spend`  | chart     | —         | A bar chart of annual spend by department (long labels + large values). |

`department_spend` deliberately uses long department names and multi-million values, exercising the
long-label handling (the bar flips horizontal / rotates so no label is dropped) and compact
large-number axis labels (`$4M`, not `4,200,000`).

## Run

```bash
# from the repo ROOT (builds core + widget so the workspace:* dist has the exports)
pnpm install
pnpm build

# then, in this directory:
pnpm start            # listens on http://localhost:3000/mcp  (set PORT to change)
```

## MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

In the Inspector: set **Transport Type** to **Streamable HTTP**, **URL** to
`http://localhost:3000/mcp`, click **Connect**, then:

1. Call **`explore_views`** to see the catalog of the six views (id, title, description, params).
2. Call **`render_view`** with `{ "view_id": "sales_overview" }` and confirm the widget renders the
   grid (KPIs, a line chart, a bar chart, a text block).
3. Pass `{ "view_id": "sales_overview", "params": { "region": "EU" } }` to see the numbers change.
4. Try the single-chart views, e.g. `{ "view_id": "department_spend" }`, to see the long-label /
   large-number handling.

## Claude Desktop (Streamable HTTP via a tunnel, no auth)

Claude Desktop remote connectors need a public HTTPS URL, so expose the local server with a tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

That prints a public `https://<name>.trycloudflare.com` URL. In Claude Desktop, add a **custom
connector** pointing at `https://<name>.trycloudflare.com/mcp` (no auth), then prompt *"explore the
available views and show me the sales overview"*.

The tunnel is required only because a remote connector needs a public HTTPS URL. There is still **no
OAuth / no auth** and **no npm publish** (the server runs the local `workspace:*` build). If a given
Claude Desktop build does not render MCP-Apps widgets, use the Inspector above to see the visual.

## How it works

`addDashboardViews` registers the widget resource plus both tools:

- **`explore_views`** returns the catalog as `structuredContent.views` (and a text list), so the agent
  discovers what it can render before calling anything.
- **`render_view`** validates the chosen `view_id` (enum) and any per-view `params` (strict zod),
  calls that view's `render`, and returns either a `ChartSpec` or a `DashboardSpec` bound to the
  widget via `_meta.ui.resourceUri` (with the `openai/outputTemplate` alias for the ChatGPT Apps SDK).

One cacheable `ui://bonnard/chart` resource serves the widget; it discriminates a `DashboardSpec`
(`items`) from a single `ChartSpec` (`data`) and renders either. A permissive `outputSchema` declares
the envelope so hosts that gate `structuredContent` on a schema still forward it.

The server runs **stateless** (a fresh server + transport per request, no sessions), so a restart is
invisible to the client and Claude Desktop's "reload tools" keeps working across restarts.
