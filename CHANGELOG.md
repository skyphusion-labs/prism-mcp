## Unreleased

### Added
- Tool annotations (`readOnlyHint` / `destructiveHint` / `idempotentHint`, MCP 2025-06-18) on all
  33 tools, so a client can auto-approve reads and gate the tools that can irreversibly change or
  discard state (`delete_history`, `delete_conversation`, `delete_document`, `delete_project`,
  `update_prefs`, `prism_request`) instead of prompting on every call or approving all 33 blind.
  `prism_request` is marked destructive because its method and path are runtime arguments, so it
  can issue a DELETE to any curated-tool route and more.

### Fixed
- `initialize` no longer echoes an unvalidated client `protocolVersion`; always responds with the
  one version this server implements.
- `prism_request` refused a path-prefixed `PRISM_URL` mount escape via `..` normalization
  (`../../admin/keys` resolving outside the configured mount); bare-host deployments, the
  documented default, are unaffected.
- `create_project` and `import_discord` now enforce their own declared `inputSchema.required`
  fields (`name`, `body`) instead of relying on the calling client to have validated them first.
- `chat` / `chat_stream` now forward the trimmed `model` / `user_input` values they validate,
  instead of validating a trimmed copy and sending the untrimmed originals.
- `get_artifact` / `prism_request` now stream and check the 4MB image inline cap incrementally,
  instead of buffering the full upstream body before checking it.
- A body-read failure (SSE, image, or generic text) inside a tool call no longer escapes as a
  thrown exception; batch requests no longer lose already-computed responses when a later element
  fails mid-read.
- JSON-RPC batches are capped at 50 messages; an oversized batch is refused with a JSON-RPC error
  instead of making unbounded prism calls from one request.
- Docs: scoped the "agent never sees the prism cookie" guarantee to normal use (it does not cover
  a prism deployment whose own routes reflect session material back in a response), and documented
  that `prism_request` and RAG/web-search-augmented `chat` output relay remote text verbatim into
  the agent's context, untrusted and undelimited.

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
