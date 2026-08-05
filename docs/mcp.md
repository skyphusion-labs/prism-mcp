# Prism MCP

Drive [Prism](https://play.skyphusion.org) from an AI agent (Claude Code, Cursor, or any MCP client)
instead of the browser. Implementation: **`@skyphusion/prism-mcp`**.

**License:** MIT for this door. Prism remains AGPL-3.0-only.

## Why a separate Worker

- **Two credentials.** Agent presents `MCP_TOKEN`; prism session cookie (`PRISM_SESSION`) never leaves the Worker.
- **No prism bindings.** Points at any prism URL over HTTPS.
- **Stateless.** Long jobs: agent calls `poll_job` / `poll_import`.

```
Agent --Bearer MCP_TOKEN--> prism-mcp --Cookie __Host-prism_session--> prism (PRISM_URL)
```

## Before you start

1. A reachable prism over HTTPS (hosted play or self-host).
2. A logged-in **session** for the account the agent should act as:
   - Sign up / log in on the SPA, or `POST /api/auth/login` with username/password.
   - Copy the `__Host-prism_session` cookie value (devtools → Application → Cookies, or
     `Set-Cookie` from login).
   - That raw value is `PRISM_SESSION` (never commit it).
3. Configure that account's gateway / `pcp_` key under Account prefs if you want inference to work
   (same as a human user on play).
4. A custom domain for the MCP Worker (example: `prism-mcp.example.com`).

## Deploy

| Value | Kind | What |
|-------|------|------|
| `PRISM_URL` | var | e.g. `https://play.skyphusion.org` |
| `PRISM_SESSION` | secret | Cookie value for `__Host-prism_session` |
| `MCP_TOKEN` | secret | Agent bearer |

```sh
MCP_HOST="prism-mcp.example.com" MCP_PRISM_URL="https://play.skyphusion.org" \
  envsubst '$MCP_HOST $MCP_PRISM_URL' < wrangler.mcp.toml.example > wrangler.mcp.toml

npx wrangler deploy -c wrangler.mcp.toml
npx wrangler secret put PRISM_SESSION -c wrangler.mcp.toml
umask 077 && openssl rand -hex 32 > mcp-token.txt
npx wrangler secret put MCP_TOKEN -c wrangler.mcp.toml < mcp-token.txt
```

Optional Access-mode vars/secrets: `PRISM_ACCESS_EMAIL`, `PRISM_ACCESS_CLIENT_ID`,
`PRISM_ACCESS_CLIENT_SECRET` (see `src/mcp-env.ts`).

## Check that it works

```sh
curl -s https://prism-mcp.example.com/health
# {"ok":true,"service":"prism-mcp"}

curl -s https://prism-mcp.example.com/mcp \
  -H "Authorization: Bearer $(cat mcp-token.txt)" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Connect an agent

MCP Streamable HTTP: `POST https://prism-mcp.example.com/mcp` with
`Authorization: Bearer <MCP_TOKEN>`.

## Tool reference

Curated tools map 1:1 to prism routes (see prism `CLAUDE.md` Routes reference). Escape hatch:
`prism_request` with `method` + `path`.

| Tool | Prism route |
|------|-------------|
| `health` / `health_deep` | `GET /health`, `GET /health/deep` |
| `list_models` | `GET /api/models` |
| `get_prefs` / `update_prefs` | `GET` / `PATCH /api/prefs` |
| `chat` | `POST /api/chat` (all model types) |
| `chat_stream` | `POST /api/chat/stream` (SSE drained to text) |
| `tts` | `POST /api/tts` |
| `list_history` / `get_history` / `delete_history` | `/api/history` |
| `list_conversations` / `get_conversation` / `delete_conversation` | `/api/conversations` |
| `move_conversation_to_project` | `PATCH /api/conversations/:id/project` |
| `list_documents` / `get_document` / `upload_document` / `delete_document` | `/api/documents` |
| `poll_import` | `GET /api/import/:id` |
| `list_projects` … `import_discord` | `/api/projects` |
| `poll_job` | `GET /api/job/:id` |
| `get_artifact` | `GET /api/artifact/*` |
| `prism_request` | any path |

### Out of scope

- **WebSocket STT** (`/api/stt/stream`): live mic; not an MCP tool in v0.1.
- **Account delete**: use the SPA or `prism_request` deliberately.

## Security boundary

- Agent compromise exposes `MCP_TOKEN` only; rotate without touching the prism account.
- Prism session compromise is the same as a stolen browser cookie; revoke via logout / delete sessions on prism.
- Never put secrets in the git repo or agent config files that get committed.

## Hosted door

First-party Worker: `https://prism-mcp.skyphusion.org` (tag-gated deploy on `prism-mcp-v*`).
Self-host still supported via wrangler template.
