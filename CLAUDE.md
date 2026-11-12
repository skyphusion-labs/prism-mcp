# CLAUDE.md

Guidance for Claude Code (and the crew) working in this repo.

## What this is

**`@skyphusion/prism-mcp`:** MCP door for the Prism playground API. Stateless Streamable-HTTP
Worker that proxies curated tools to a prism host (`PRISM_URL`). Implementation lives here; deploy
config is wrangler + secrets only.

**Status: v1.1.0** (root `package.json`). Peers are not all on that number: **prism** and
**prism-control-plane** are 1.1.1, **prism-ios** and **prism-android** are still 1.0.0.

- Tool catalog: `export const TOOLS` in `src/mcp-tools.ts` (re-count from code if the number drifts).
- License: **MIT** (client door). Prism remains AGPL.
- Version: root `package.json` / release tags / `CHANGELOG.md`.

## Relation to the stack

| Repo | Role |
|------|------|
| **This package** | MCP server + tool catalog (npm + Worker entry), package 1.1.0 |
| `prism` | Multimodal playground API (`/api/*`), package 1.1.1 |
| `prism-control-plane` | Metered proxy; used when the prism user has a `pcp_` key in prefs, package 1.1.1 |
| `prism-ios` / `prism-android` | Native clients, marketing version 1.0.0 |

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
- **One tool, one route** (+ `prism_request_read` / `prism_request_write` escape
  hatch; `prism_request` is a write-only alias). Live WebSocket STT
  (`/api/stt/stream`) is out of scope for MCP tools.

```mermaid
flowchart LR
  Agent -->|"Bearer MCP_TOKEN"| MCP["prism-mcp"]
  MCP -->|"Cookie session"| Prism["prism PRISM_URL"]
  Prism --> GW["AI Gateway"]
```

Public docs with full diagrams: `README.md`, `docs/mcp.md`, `docs/PARITY.md`.

## Hard rules

- Typecheck is the CI gate. Run before push.
- Never a plaintext secret in a tracked file.
- No em-dashes / en-dashes; use `--` or commas.
- Verify live `/health` + tools/list, not only green CI.
- Aviation-grade `main` (PR-required, CI green) on the public repo.

## Crew + identity

Conrad laptop commits: `Conrad Rockenhaus <conrad@skyphusion.org>`. Crew: member
identity via `sudo -n -H -u <member> bash -lc`. Conventional Commits; SemVer on the package.

## Hosted door

First-party Worker: `https://prism-mcp.skyphusion.org` (tag-gated deploy on `prism-mcp-v*`).
Self-host still supported via wrangler template.

## Release convention (bump-at-release)

One convention for every skyphusion-labs repo (Conrad, ruled 2026-11-10, fleet-chezmoi#1766). A version moves ONLY in a release PR: bump the version, then assemble the changelog. Feature and fix PRs do not bump. Releases go through a PR (fleet-chezmoi#1622) and the tag goes on that PR's merge commit.

- Version of record here: package.json.
- Tag shape: `prism-mcp-v*`.
- Check before a release PR: does a tag already exist for the version currently in the manifest? Yes means the cycle is closed, so the release PR bumps. No means a bump already landed outside a release PR; stop and read why before bumping again.
