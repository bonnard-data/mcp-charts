# Embed mode example

Two Bonnard cells inside this page's own cards, wired the way a consumer would wire them: an iframe on
`#embed`, sandboxed with `allow-scripts` only, fed over `bonnard:render`.

The left card is fill-sized, so the chart takes the card's height at 1:1. The right card starts at 40px
and grows to whatever `bonnard:size` reports, with the measurement printed next to its header.

```bash
pnpm build                    # from the repo root; populates packages/widget/dist
python3 -m http.server 8000   # from the repo root
# open http://localhost:8000/examples/embed/
```

Pickers cover the payload kinds (bare KPI, bare chart, a bare `ChartSpec`, a table, a text block, one
cell of a `DashboardSpec` via `item`, a whole dashboard), light and dark themes, and three token sets,
including one with an invalid key and a value carrying a `;` so you can watch validation drop them.

`fixtures.js` holds the payloads. The widget test suite imports the same file, so what renders here is
what the structural snapshots lock.

The full reference lives in [docs/EMBED-MODE.md](../../docs/EMBED-MODE.md).
