# homebox_mcp — this host's deployment

This is the operational/deployment reference for **this** host's instance.
`README.md` in this directory is the upstream project's own docs (from the
fork) — don't merge deployment notes into it, since `git fetch upstream &&
git merge upstream/main` would conflict with local edits there.

## What runs where

| What | Where |
|---|---|
| MCP endpoint (Streamable HTTP) | `http://192.168.20.15:8765/mcp` (LAN), `https://inventory.brbjr.com/mcp` (public, NPM Custom Location) |
| Homebox it talks to | `http://192.168.20.15:3100` (see `/mnt/user/appdata/homebox/README.md`) |
| Source checkout | `/mnt/user/appdata/homebox_mcp/` (`git clone` of `https://github.com/brbjr1/homebox_mcp`, `main` branch) |
| Secrets/config | `/mnt/user/appdata/homebox_mcp/.env` (chmod 600, **git-ignored** — confirmed with `git check-ignore .env`) |
| Auth | Bearer token in `MCP_AUTH_TOKEN` (`.env`) — required on every request |
| Service account | `agent@brbjr.com`, member of "Bruce Behrens's Home" — see the group gotcha in `/mnt/user/appdata/homebox/README.md` |

**Note on the NPM setup:** the plan originally called for a separate
`homebox-mcp.brbjr.com` subdomain. It was built instead as a **Custom
Location** (`/mcp`) under the existing `inventory.brbjr.com` proxy host, with
`client_max_body_size 30m;` in that location's advanced Nginx config (NPM's
default 1 MB cap would otherwise silently break base64 photo uploads). The
NPM container here is `jlesage/nginx-proxy-manager`, whose HTTPS listener is
published on host port **18443**, not 443 — relevant only if you ever need to
test the proxy from *this same host* (hairpin NAT means you can't reach
`inventory.brbjr.com` from itself via the public path; use
`curl -k --resolve inventory.brbjr.com:18443:192.168.20.15 https://inventory.brbjr.com:18443/...`
instead, or just hit `192.168.20.15:8765` / `:3100` directly).

## Restart / rebuild

```bash
/mnt/user/appdata/homebox_mcp/run.sh
```
Idempotent — rebuilds the Docker image from the current checkout, then
stops/removes/recreates the container. Always use this, not ad-hoc
`docker build`/`run`, so the container never drifts from `.env`.

## Update from upstream

```bash
cd /mnt/user/appdata/homebox_mcp
git fetch upstream
git merge upstream/main
./run.sh
```
(`upstream` remote = `https://github.com/luisriverag/homebox_mcp.git`, the
non-fork this was forked from.)

## Using the MCP server locally (curl)

Useful for debugging without going through a client. Streamable HTTP requires
an `initialize` call first to get a session id, then reuse that session id on
subsequent `tools/call` requests.

```bash
TOKEN=$(grep ^MCP_AUTH_TOKEN= /mnt/user/appdata/homebox_mcp/.env | cut -d= -f2)

# 1. Initialize a session and capture the session id
SID=$(curl -s -D - -o /dev/null http://localhost:8765/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -X POST \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
  | grep -i mcp-session-id | tr -d '\r' | awk '{print $2}')
echo "session: $SID"

# 2. List available tools
curl -s http://localhost:8765/mcp \
  -H "Authorization: Bearer $TOKEN" -H "mcp-session-id: $SID" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -X POST -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 3. Call a tool, e.g. confirm which Homebox group the server is scoped to
curl -s http://localhost:8765/mcp \
  -H "Authorization: Bearer $TOKEN" -H "mcp-session-id: $SID" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -X POST -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"group_get","arguments":{}}}'

# 4. List locations
curl -s http://localhost:8765/mcp \
  -H "Authorization: Bearer $TOKEN" -H "mcp-session-id: $SID" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -X POST -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"locations_list","arguments":{}}}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); c=json.loads(d['result']['content'][0]['text']); print(len(c), [x['name'] for x in c])"
```

**Unauthenticated requests must get `401`** — sanity-check any change to
`.env` or the proxy with:
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8765/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

`tools/call` for a write tool (e.g. `items_create`, `locations_create`)
follows the same shape — swap `"params":{"name":"...","arguments":{...}}`.
Any tool's exact input schema can be pulled from the `tools/list` response
above.

## Known constraints (don't "fix" these)

- `items_create` deliberately has no serial/price/insured fields — a
  follow-up `items_update` on the returned id is mandatory. This is enforced
  by the fork's schema, not an oversight.
- `MCP_HTTP_BODY_LIMIT_BYTES=26214400` (25 MiB) and the NPM
  `client_max_body_size 30m;` are both sized for base64-inflated phone
  photos (~33% larger than the raw file). Don't shrink either without
  checking real photo sizes first.

## Backups

Same automatic coverage as Homebox itself — see
`/mnt/user/appdata/homebox/README.md` § Backups. `.env` (with the bearer
token and the agent's Homebox password) is inside `/mnt/user/appdata`, so
it's covered by the nightly restic run; it is deliberately **not** committed
to git.
