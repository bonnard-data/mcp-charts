#!/usr/bin/env bash
# Boot the example dashboard MCP server (if down) + launch MCP Inspector pointed at it, so a dev
# can call explore_views / render_view interactively over Streamable HTTP.
#
# Uses an ALTERNATE port by default so it never collides with the long-running dev-tunnel server on
# :3000. Inspector proxy/client ports are overridable for the same reason.
#
# Usage:
#   scripts/dev-inspect.sh                                  # server on :3011, inspector default ports
#   PORT=3012 scripts/dev-inspect.sh                        # override server port
#   CLIENT_PORT=6280 SERVER_PORT=6281 scripts/dev-inspect.sh # override inspector ports if one is busy
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3011}"
MCP_URL="http://localhost:${PORT}/mcp"

probe() {
  curl -sf -o /dev/null -X POST "$MCP_URL" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}'
}

if ! probe; then
  echo "starting example-dashboard server on :${PORT}"
  (cd "$ROOT/examples/dashboard" && PORT="$PORT" pnpm start > "/tmp/bonnard-dashboard-${PORT}.log" 2>&1 &)
  for _ in $(seq 1 20); do
    probe && break
    sleep 0.5
  done
else
  echo "server already up on :${PORT}"
fi

echo "inspector -> ${MCP_URL} (transport: streamable-http)"
# --transport/--server-url preselect the connection so the UI opens ready to connect.
exec npx --yes @modelcontextprotocol/inspector --transport streamable-http --server-url "$MCP_URL"
