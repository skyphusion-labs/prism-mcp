import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker from "../src/mcp.js";
import type { McpEnv } from "../src/mcp-env.js";
import { TOOLS, PRISM_SESSION_COOKIE } from "../src/mcp-tools.js";

const ENV: McpEnv = {
  PRISM_URL: "https://play.example.com",
  PRISM_SESSION: "session-secret-token",
  MCP_TOKEN: "gate-secret",
};

function mcpRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://prism-mcp.example.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const AUTH = { Authorization: `Bearer ${ENV.MCP_TOKEN}` };

let calls: { url: string; init: RequestInit }[] = [];
function stubFetch(reply: unknown, status = 200, contentType = "application/json") {
  calls = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), {
      status,
      headers: { "content-type": contentType },
    });
  }) as unknown as typeof fetch;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("prism MCP transport", () => {
  it("serves /health without auth", async () => {
    const res = await worker.fetch(new Request("https://x/health"), ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "prism-mcp" });
  });

  it("fails closed with no bearer (401)", async () => {
    const res = await worker.fetch(mcpRequest({ jsonrpc: "2.0", id: 1, method: "ping" }), ENV);
    expect(res.status).toBe(401);
  });

  it("fails closed when MCP_TOKEN is unset even with a bearer", async () => {
    const res = await worker.fetch(
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "ping" }, AUTH),
      { ...ENV, MCP_TOKEN: undefined },
    );
    expect(res.status).toBe(401);
  });

  it("lists curated tools + escape hatch", async () => {
    const res = await worker.fetch(
      mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, AUTH),
      ENV,
    );
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain("list_models");
    expect(names).toContain("chat");
    expect(names).toContain("chat_stream");
    expect(names).toContain("list_projects");
    expect(names).toContain("upload_document");
    expect(names).toContain("get_artifact");
    expect(names).toContain("prism_request");
    expect(names.length).toBe(TOOLS.length);
  });

  it("initialize echoes server info", async () => {
    const res = await worker.fetch(
      mcpRequest({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} }, AUTH),
      ENV,
    );
    const body = (await res.json()) as { result: { serverInfo: { name: string; version: string } } };
    expect(body.result.serverInfo.name).toBe("prism");
    expect(body.result.serverInfo.version).toBe("1.0.0");
  });

  it("a notification (no id) returns 202 with no body", async () => {
    const res = await worker.fetch(
      mcpRequest({ jsonrpc: "2.0", method: "initialized" }, AUTH),
      ENV,
    );
    expect(res.status).toBe(202);
  });
});

describe("prism MCP tool dispatch", () => {
  beforeEach(() => stubFetch({ ok: true }, 200));

  it("chat posts /api/chat with session cookie", async () => {
    stubFetch({ id: 1, output: "hello" }, 200);
    const res = await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 10,
          method: "tools/call",
          params: {
            name: "chat",
            arguments: { model: "@cf/meta/llama-3.1-8b-instruct", user_input: "hi" },
          },
        },
        AUTH,
      ),
      ENV,
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://play.example.com/api/chat");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Cookie).toBe(`${PRISM_SESSION_COOKIE}=session-secret-token`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: "@cf/meta/llama-3.1-8b-instruct",
      user_input: "hi",
    });
    const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0].text).toContain("hello");
  });

  it("list_models hits GET /api/models", async () => {
    stubFetch({ models: [], mode: "public", authenticated: true }, 200);
    const res = await worker.fetch(
      mcpRequest(
        { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "list_models", arguments: {} } },
        AUTH,
      ),
      ENV,
    );
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe("https://play.example.com/api/models");
    expect(calls[0].init.method).toBe("GET");
  });

  it("get_artifact encodes multi-segment keys", async () => {
    stubFetch("PNG", 200, "image/png");
    await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 12,
          method: "tools/call",
          params: { name: "get_artifact", arguments: { key: "out/user/x y.png" } },
        },
        AUTH,
      ),
      ENV,
    );
    expect(calls[0].url).toBe("https://play.example.com/api/artifact/out/user/x%20y.png");
  });

  it("move_conversation_to_project patches project_id null", async () => {
    stubFetch({ ok: true }, 200);
    await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 13,
          method: "tools/call",
          params: {
            name: "move_conversation_to_project",
            arguments: { id: "conv_abc", project_id: null },
          },
        },
        AUTH,
      ),
      ENV,
    );
    expect(calls[0].url).toBe("https://play.example.com/api/conversations/conv_abc/project");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ project_id: null });
  });

  it("refuses authenticated tools without PRISM_SESSION", async () => {
    const res = await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 14,
          method: "tools/call",
          params: { name: "list_history", arguments: {} },
        },
        AUTH,
      ),
      { ...ENV, PRISM_SESSION: undefined, PRISM_ACCESS_EMAIL: undefined },
    );
    const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/PRISM_SESSION/);
    expect(calls).toHaveLength(0);
  });

  it("prism_request escape hatch", async () => {
    stubFetch({ ok: true }, 200);
    await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 15,
          method: "tools/call",
          params: {
            name: "prism_request",
            arguments: { method: "GET", path: "/api/prefs" },
          },
        },
        AUTH,
      ),
      ENV,
    );
    expect(calls[0].url).toBe("https://play.example.com/api/prefs");
  });

  it("bad tool arguments become isError results", async () => {
    const res = await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 16,
          method: "tools/call",
          params: { name: "chat", arguments: { model: "x" } },
        },
        AUTH,
      ),
      ENV,
    );
    const body = (await res.json()) as { result: { isError: boolean } };
    expect(body.result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
