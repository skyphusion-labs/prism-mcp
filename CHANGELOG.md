## Unreleased

### Docs
- README, `docs/mcp.md`, `docs/PARITY.md`: mermaid architecture, auth, job poll,
  compact, stack position, SPA↔tool map, voice workaround sequences (aligned with
  prism / plane / iOS README style).

## v1.0.0

Agent HTTP parity release for Prism playground (play.skyphusion.org).

### Added
- **`compact_conversation` / `clear_conversation_compact`** -- POST/DELETE
  `/api/conversations/:id/compact` (prism v0.175.7+), first-class tools.

### Parity claim
- **Curated tools cover every prism HTTP `/api/*` route** a human SPA uses for
  chat, multimodal gen, history, RAG, projects, Discord import, jobs, artifacts,
  prefs, and compact. Escape hatch: `prism_request`.
- **Still not real-time voice:** WebSocket `/api/stt/stream` (Deepgram Flux live
  mic + voice-chat loop) has no MCP equivalent. Agents approximate with
  `chat` (stt model + audio attachment) → `chat` → `tts` / chat TTS models.
- Auth session is operator-seeded (`PRISM_SESSION`); signup/login via
  `prism_request` if needed. Account delete is deliberate SPA / escape-hatch only.

### Hosted
- Tag-gated deploy: `prism-mcp-v1.0.0` → `https://prism-mcp.skyphusion.org`


## v0.1.3

fix(dist): re-publish under @skyphusion (packument repair attempt)

Local publish of 0.1.3 after partial 0.1.2 state. Package name is `@skyphusion/prism-mcp`.

## v0.1.2

fix(dist): publish as `@skyphusion/prism-mcp` (correct npm scope)

Estate convention is `@skyphusion/*` (create-prism, crew-bus, search-mcp, …).
`@skyphusion-labs/prism-mcp` was wrong scope and 0.1.0/0.1.1 under labs were
ghost or mis-scoped. Rename and re-release under `@skyphusion`.

## v0.1.1

fix(dist): re-publish to npm (0.1.0 was a ghost / not installable)

CI reported `@skyphusion/prism-mcp@0.1.0` published with provenance, but
the registry document 404s and re-publish is blocked as "already published".
Bump PATCH and ship a real public release.

## v0.1.0

feat: initial Prism MCP door (full HTTP API parity)

MIT-licensed Streamable-HTTP MCP Worker for agents. Proxies curated tools to a
prism instance (`PRISM_URL`) with a server-side session cookie (`PRISM_SESSION`)
and a separate agent gate (`MCP_TOKEN`).

### Tools
- Health: `health`, `health_deep`
- Catalog / prefs: `list_models`, `get_prefs`, `update_prefs`
- Generation: `chat`, `chat_stream` (SSE drained to text), `tts`
- History / conversations: list/get/delete + `move_conversation_to_project`
- RAG: list/get/upload/delete documents, `poll_import`
- Projects: CRUD, attach/detach docs, `import_discord`
- Jobs / artifacts: `poll_job`, `get_artifact` (image inline)
- Escape: `prism_request`

### Out of scope (v0.1)
- Live WebSocket STT (`/api/stt/stream`) -- not representable as a request/response tool.
- Direct control-plane (`play-proxy`) tools -- use prism prefs + `pcp_` on the session.

### Code
- `src/mcp.ts`, `src/mcp-env.ts`, `src/mcp-tools.ts`
- tests, docs/mcp.md, wrangler.mcp.toml.example, CI + publish-npm
