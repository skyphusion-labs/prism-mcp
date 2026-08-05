# @skyphusion/prism-mcp

**License:** MIT  
**API:** [prism](https://github.com/skyphusion-labs/prism) (AGPL playground Worker)  
**Control plane (metered chat):** [prism-control-plane](https://github.com/skyphusion-labs/prism-control-plane)

Agent **MCP** for [Prism](https://play.skyphusion.org): full HTTP parity with the prism `/api/*`
surface so coding agents can chat, generate images/video/music/TTS, manage RAG documents and
projects, and poll long jobs -- without a browser.

Stateless [Model Context Protocol](https://modelcontextprotocol.io/) Worker that proxies curated
tools to a prism instance over HTTPS.

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

## Package layout

| Import | Role |
|--------|------|
| `@skyphusion/prism-mcp` | Default Worker export (`fetch` handler) |
| `@skyphusion/prism-mcp/mcp-env` | `McpEnv` bindings |
| `@skyphusion/prism-mcp/mcp-tools` | Tool catalog + `runTool` |

## License

MIT (this package). Prism itself remains AGPL-3.0-only.

## Hosted door

First-party Worker: `https://prism-mcp.skyphusion.org` (tag-gated deploy on `prism-mcp-v*`).
Self-host still supported via wrangler template.
