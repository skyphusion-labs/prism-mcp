# CLAUDE.md

Guidance for Claude Code (and the crew) working in this repo.

## What this is

**`@skyphusion/prism-mcp`:** MCP door for the Prism playground API. Stateless Streamable-HTTP
Worker that proxies curated tools to a prism host (`PRISM_URL`). Implementation lives here; deploy
config is wrangler + secrets only.

- Tool catalog: `export const TOOLS` in `src/mcp-tools.ts` (re-count from code if the number drifts).
- License: **MIT** (client door). Prism remains AGPL.
- Version: root `package.json` / `prism-mcp-v*` tags / `CHANGELOG.md`.

## Relation to the stack

| Repo | Role |
|------|------|
| **This package** | MCP server + tool catalog (npm + Worker entry) |
| `prism` | Multimodal playground API (`/api/*`) |
| `prism-control-plane` | Metered chat proxy; used when the prism user has a `pcp_` key in prefs |
| `prism-ios` / `prism-android` | Native clients (separate) |

MCP talks to **prism**, not directly to the control plane. Control-plane spend is whatever the
seeded prism session has configured under Account prefs.

## Commands

```bash
npm run typecheck
npm test
npm run test:coverage
npm run build
```

## Deploy model

1. **npm publish** on tag `prism-mcp-v*` (`.github/workflows/publish-npm.yml`). Tag must match
   `package.json` and be an ancestor of `main`.
2. **Worker deploy** is operator-side: pin the package, `main` → `dist/mcp.js`, secrets
   `MCP_TOKEN` + `PRISM_SESSION`, var `PRISM_URL`. See `wrangler.mcp.toml.example` and `docs/mcp.md`.

## Architecture (load-bearing)

- **Two credentials.** Agent presents `MCP_TOKEN`; Worker forwards prism session cookie. Prism
  cookie never leaves the Worker.
- **No prism bindings.** Pure HTTP to `PRISM_URL`.
- **Stateless.** Video/music/zip jobs: agent polls `poll_job` / `poll_import`.
- **One tool, one route** (+ `prism_request` escape hatch). Live WebSocket STT
  (`/api/stt/stream`) is out of scope for MCP tools.

## Hard rules

- Typecheck is the CI gate. Run before push.
- Never a plaintext secret in a tracked file.
- No em-dashes / en-dashes; use `--` or commas.
- Verify live `/health` + tools/list, not only green CI.
- Aviation-grade `main` (PR-required, CI green) on the public repo.

## Crew + identity

Conrad laptop commits: `Conrad Rockenhaus <conrad@skyphusion.org>`. Crew on dischord: member
identity via `sudo -u <member>`. Conventional Commits; SemVer on the package.

## Hosted door

First-party Worker: `https://prism-mcp.skyphusion.org` (tag-gated deploy on `prism-mcp-v*`).
Self-host still supported via wrangler template.
