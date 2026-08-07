# @skyphusion/prism-mcp

**License:** MIT  
**Version:** 1.0.0  
**API:** [prism](https://github.com/skyphusion-labs/prism) (AGPL playground Worker)  
**Control plane (metered commercial door):** [prism-control-plane](https://github.com/skyphusion-labs/prism-control-plane)  
**Native clients:** [prism-ios](https://github.com/skyphusion-labs/prism-ios), [prism-android](https://github.com/skyphusion-labs/prism-android)

Agent **MCP** for [Prism](https://play.skyphusion.org): HTTP parity with the prism `/api/*`
surface so coding agents can chat, generate images/video/music/TTS, manage RAG documents and
projects, compact long threads, and poll long jobs -- without a browser.

Stateless [Model Context Protocol](https://modelcontextprotocol.io/) Worker that proxies curated
tools to a prism instance over HTTPS.

**Parity:** [docs/PARITY.md](docs/PARITY.md) -- full HTTP agent parity in 1.0.0; live Flux mic
WebSocket is the only major human SPA gap.

## How the pieces fit together

```mermaid
flowchart TB
  subgraph agents["MCP clients"]
    CC["Claude Code / Cursor / any MCP client"]
  end

  subgraph mcp["Worker: prism-mcp<br/>prism-mcp.skyphusion.org"]
    Gate["Bearer MCP_TOKEN"]
    Tools["31 curated tools + prism_request"]
    Proxy["HTTPS proxy<br/>Cookie __Host-prism_session"]
    Gate --> Tools --> Proxy
  end

  subgraph play["Worker: prism / skyphusion-llm<br/>play.skyphusion.org"]
    Auth["Session auth"]
    API["/api/* HTTP surface"]
    RAG["RAG · projects · compact"]
    Jobs["LongRunWorkflow<br/>video · music"]
    STTws["WS /api/stt/stream<br/>Flux live voice"]
    Auth --> API
    API --> RAG
    API --> Jobs
  end

  subgraph plane["Optional hybrid spend"]
    PCP["prism-control-plane<br/>play-proxy · pcp_ in prefs"]
  end

  subgraph cf["Cloudflare AI"]
    GW["AI Gateway"]
    WAI["Workers AI + Unified Billing"]
    GW --> WAI
  end

  CC -->|"tools/call<br/>Streamable HTTP"| Gate
  Proxy -->|"PRISM_URL + session cookie"| Auth
  API --> GW
  Jobs --> GW
  Auth -.->|"prefs may hold pcp_"| PCP
  PCP -.-> GW
  STTws -.->|"not MCP-transportable<br/>v1.0 gap"| agents
```

### Auth and credential split

```mermaid
sequenceDiagram
  participant A as Agent
  participant M as prism-mcp
  participant P as prism

  Note over A,M: Agent never sees the prism cookie
  A->>M: Authorization: Bearer MCP_TOKEN
  M->>M: gate token
  M->>P: Cookie __Host-prism_session=PRISM_SESSION
  P-->>M: /api/* JSON / SSE / binary
  M-->>A: MCP tool result
```

### Typical tool call (chat)

```mermaid
sequenceDiagram
  participant A as Agent
  participant M as prism-mcp
  participant P as prism
  participant G as AI Gateway

  A->>M: tools/call chat {model, messages, …}
  M->>P: POST /api/chat (+ session cookie)
  P->>G: env.AI.run / provider
  G-->>P: completion / artifact meta
  P-->>M: JSON body
  M-->>A: text content block
```

### Long-run job (video / music)

```mermaid
sequenceDiagram
  participant A as Agent
  participant M as prism-mcp
  participant P as prism
  participant W as LongRunWorkflow

  A->>M: tools/call chat (video/music model)
  M->>P: POST /api/chat
  P->>W: enqueue
  P-->>M: job id (or pending)
  M-->>A: job id
  loop until done
    A->>M: tools/call poll_job {id}
    M->>P: GET /api/job/:id
    P-->>M: status / result
    M-->>A: status
  end
  opt artifact
    A->>M: tools/call get_artifact {path}
    M->>P: GET /api/artifact/*
    P-->>A: bytes or URL meta
  end
```

### Compact multi-turn context

```mermaid
flowchart LR
  L["list / get_conversation"] --> C["compact_conversation"]
  C --> Chat["chat with conversation_id"]
  Chat --> Clear["clear_conversation_compact"]
  Clear --> Chat
```

### Stack position (vs native / control plane)

```mermaid
flowchart LR
  subgraph human["Human paths"]
    SPA["Browser SPA<br/>play.skyphusion.org"]
    iOS["prism-ios / android<br/>Bearer pcp_"]
  end

  subgraph agent["Agent path"]
    MCP["prism-mcp<br/>Bearer MCP_TOKEN"]
  end

  subgraph backends["Backends"]
    Prism["prism<br/>history · RAG · compact"]
    Plane["control plane<br/>meter · enroll · store"]
  end

  SPA --> Prism
  MCP --> Prism
  iOS --> Plane
  Prism -.->|"optional pcp_ prefs"| Plane
```

## Install

```bash
npm install @skyphusion/prism-mcp
```

## Deploy (Cloudflare Workers)

```toml
main = "node_modules/@skyphusion/prism-mcp/dist/mcp.js"
```

See [docs/mcp.md](docs/mcp.md) for secrets, session seeding, agent wiring, and the tool catalog.

| Binding | Kind | Role |
|---------|------|------|
| `PRISM_URL` | var | Prism base URL (e.g. `https://play.skyphusion.org`) |
| `PRISM_SESSION` | secret | Raw `__Host-prism_session` cookie value |
| `MCP_TOKEN` | secret | Agent gate (`Authorization: Bearer …`) |

Optional: `PRISM_ACCESS_EMAIL`, `PRISM_ACCESS_CLIENT_ID`, `PRISM_ACCESS_CLIENT_SECRET` for
Access-mode / Access-fronted self-hosts.

## Tools (1.0.0)

| Area | Tools |
|------|--------|
| Health | `health`, `health_deep` |
| Catalog / prefs | `list_models`, `get_prefs`, `update_prefs` |
| Generation | `chat`, `chat_stream`, `tts` |
| History | `list_history`, `get_history`, `delete_history` |
| Conversations | `list/get/delete_conversation`, `move_conversation_to_project`, **`compact_conversation`**, **`clear_conversation_compact`** |
| RAG | `list/get/upload/delete_document`, `poll_import` |
| Projects | CRUD, attach/detach docs, `import_discord` |
| Jobs / media | `poll_job`, `get_artifact` |
| Escape | `prism_request` (any path) |

**31 curated tools** + `prism_request`. Full route map: [docs/mcp.md](docs/mcp.md).  
**Not a tool:** WebSocket `/api/stt/stream` (live Flux). Approximate with STT `chat` + `tts`.

## Package layout

| Import | Role |
|--------|------|
| `@skyphusion/prism-mcp` | Default Worker export (`fetch` handler) |
| `@skyphusion/prism-mcp/mcp-env` | `McpEnv` bindings |
| `@skyphusion/prism-mcp/mcp-tools` | Tool catalog + `runTool` |

## Docs

| Doc | Contents |
|-----|----------|
| [docs/mcp.md](docs/mcp.md) | Deploy, secrets, agent connect, tool → route table |
| [docs/PARITY.md](docs/PARITY.md) | Human SPA vs MCP matrix, gaps, voice workaround |

## License

MIT (this package). Prism itself remains AGPL-3.0-only.

## Hosted door

First-party Worker: `https://prism-mcp.skyphusion.org` (tag-gated deploy on `prism-mcp-v*`).
Self-host still supported via wrangler template.
