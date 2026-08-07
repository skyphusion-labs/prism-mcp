// Prism MCP Worker.
//
// Stateless Streamable-HTTP MCP server that lets an AI agent drive the Prism
// playground API (play.skyphusion.org or any self-hosted prism) through curated
// tools instead of raw curl. Separate Worker from prism; no prism bindings;
// reaches prism purely over HTTP with the operator's session cookie.
//
// Two independent credentials:
//   - MCP_TOKEN      gates THIS server (every /mcp needs Authorization: Bearer).
//   - PRISM_SESSION  cookie value forwarded as __Host-prism_session; agent never
//                    sees the cookie value itself in normal use. Caveat:
//                    prism_request relays whatever body the target prism path
//                    returns verbatim, so a prism route that reflects session
//                    material back into a response body would still reach the
//                    agent through that escape hatch (see docs/mcp.md "Security
//                    boundary"). This server does not filter prism_request output.
//
// Long jobs (video/music, zip import) are agent-driven: chat returns a job id,
// then the agent polls poll_job / poll_import. This server never long-polls.

import type { McpEnv } from "./mcp-env.js";
import { TOOLS, TOOLS_BY_NAME, runTool } from "./mcp-tools.js";

// KEEP IN SYNC WITH package.json "version". Wire-visible via initialize serverInfo;
// tests/server-info-version.test.ts fails if these two disagree.
const SERVER_INFO = { name: "prism", version: "1.0.0" };
const PROTOCOL_VERSION = "2025-06-18";

// A batch is one HTTP request driving N upstream prism calls from a single
// MCP_TOKEN holder. Unbounded batching turns one request into unbounded billed
// spend; cap it rather than trust the client to behave.
const MAX_BATCH_SIZE = 50;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let pad = 0;
    for (let i = 0; i < a.length; i++) pad |= a.charCodeAt(i) ^ a.charCodeAt(i);
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(status === 202 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

const PUBLIC_TOOLS = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
  ...(t.annotations ? { annotations: t.annotations } : {}),
}));

async function handleRpc(msg: RpcMessage, env: McpEnv): Promise<unknown> {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize": {
      // This server implements exactly one protocol version. Per the MCP spec,
      // when the client's requested version is not supported the server
      // responds with a version it DOES support -- so we always answer with
      // our own PROTOCOL_VERSION rather than trusting/echoing whatever the
      // client sent (which may not even be a string; a numeric or bogus
      // value must never reach the wire unvalidated).
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: PUBLIC_TOOLS });
    case "tools/call": {
      const name = params?.name as string | undefined;
      const tool = name ? TOOLS_BY_NAME.get(name) : undefined;
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
      const args = (params?.arguments as Record<string, unknown>) || {};
      let call;
      try {
        call = tool.build(args);
      } catch (err) {
        return rpcResult(id, {
          content: [{ type: "text", text: `Invalid arguments for ${name}: ${String(err)}` }],
          isError: true,
        });
      }
      try {
        const result = await runTool(env, call, {
          inlineImages: tool.inlineImages === true,
          collectSse: tool.collectSse === true,
        });
        return rpcResult(id, result);
      } catch (err) {
        // Defense in depth: runTool guards its own body-read paths and should
        // never throw, but a tool call that DOES throw must still become a
        // JSON-RPC result, never an exception that reaches the fetch handler.
        return rpcResult(id, {
          content: [{ type: "text", text: `Tool call failed: ${String(err)}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${String(method)}`);
  }
}

export default {
  async fetch(request: Request, env: McpEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true, service: "prism-mcp" });
    }
    if (url.pathname !== "/mcp") return json({ error: "not_found" }, 404);

    const auth = request.headers.get("Authorization") ?? "";
    const expected = env.MCP_TOKEN ? `Bearer ${env.MCP_TOKEN}` : "";
    if (!env.MCP_TOKEN || !timingSafeEqual(auth, expected)) {
      return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
    }

    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }

    let payload: RpcMessage | RpcMessage[];
    try {
      payload = (await request.json()) as RpcMessage | RpcMessage[];
    } catch {
      return json(rpcError(null, -32700, "Parse error"));
    }

    const hasId = (m: RpcMessage) => m.id !== undefined && m.id !== null;

    if (Array.isArray(payload)) {
      if (payload.length > MAX_BATCH_SIZE) {
        return json(
          rpcError(
            null,
            -32600,
            `Batch of ${payload.length} messages exceeds the ${MAX_BATCH_SIZE}-message limit`,
          ),
        );
      }
      const responses: unknown[] = [];
      for (const m of payload) {
        if (!hasId(m)) continue;
        try {
          responses.push(await handleRpc(m, env));
        } catch (err) {
          // One message failing mid-read must not discard responses already
          // computed for earlier elements in the same batch.
          responses.push(rpcError(m.id ?? null, -32603, `Internal error: ${String(err)}`));
        }
      }
      return responses.length ? json(responses) : json(null, 202);
    }

    if (!hasId(payload)) return json(null, 202);

    try {
      return json(await handleRpc(payload, env));
    } catch (err) {
      return json(rpcError(payload.id ?? null, -32603, `Internal error: ${String(err)}`));
    }
  },
};
