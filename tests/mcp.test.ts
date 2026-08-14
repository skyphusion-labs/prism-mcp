import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker from "../src/mcp.js";
import type { McpEnv } from "../src/mcp-env.js";
import { TOOLS, PRISM_SESSION_COOKIE, prismUrl } from "../src/mcp-tools.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Derived, never transcribed: a hardcoded version here makes every release bump
// a test edit, and a stale literal reads as a real failure (see
// tests/server-info-version.test.ts, which pins the source literal to this file).
const PKG_VERSION = (
  JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
    version: string;
  }
).version;

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

/** Stub fetch with a hand-built streaming Response body, for read-path tests. */
function stubFetchWithStream(
  body: ReadableStream<Uint8Array>,
  status = 200,
  headers: Record<string, string> = {},
) {
  calls = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(body, { status, headers });
  }) as unknown as typeof fetch;
}

/** A stream that enqueues fixed-size chunks and counts how many times it was pulled. */
function countingChunkStream(chunkBytes: number, chunkCount: number, tracker: { pulls: number }) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      tracker.pulls++;
      if (i >= chunkCount) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunkBytes));
      i++;
    },
  });
}

/** A stream whose first read rejects, simulating an upstream reset mid-transfer. */
function throwingStream() {
  return new ReadableStream<Uint8Array>({
    pull() {
      throw new Error("upstream reset");
    },
  });
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
    expect(names).toContain("prism_request_read");
    expect(names).toContain("prism_request_write");
    expect(names).toContain("prism_request");
    expect(names.length).toBe(TOOLS.length);
  });

  it("tools/list exposes annotations so a client can gate destructive tools", async () => {
    const res = await worker.fetch(
      mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, AUTH),
      ENV,
    );
    const body = (await res.json()) as {
      result: { tools: { name: string; annotations?: Record<string, unknown> }[] };
    };
    const byName = new Map(body.result.tools.map((t) => [t.name, t.annotations]));
    expect(byName.get("delete_project")).toMatchObject({ destructiveHint: true });
    expect(byName.get("prism_request_write")).toMatchObject({ destructiveHint: true });
    expect(byName.get("prism_request")).toMatchObject({ destructiveHint: true });
    expect(byName.get("prism_request_read")).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(byName.get("health")).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(byName.get("list_projects")).toMatchObject({ readOnlyHint: true });
  });

  it("initialize echoes server info", async () => {
    const res = await worker.fetch(
      mcpRequest({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} }, AUTH),
      ENV,
    );
    const body = (await res.json()) as { result: { serverInfo: { name: string; version: string } } };
    expect(body.result.serverInfo.name).toBe("prism");
    expect(body.result.serverInfo.version).toBe(PKG_VERSION);
  });

  it("initialize never echoes an untrusted client protocolVersion", async () => {
    const bogus = await worker.fetch(
      mcpRequest(
        { jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "1999-01-01-nonexistent" } },
        AUTH,
      ),
      ENV,
    );
    const bogusBody = (await bogus.json()) as { result: { protocolVersion: string } };
    expect(bogusBody.result.protocolVersion).toBe("2025-06-18");

    const numeric = await worker.fetch(
      mcpRequest({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: 42 } }, AUTH),
      ENV,
    );
    const numericBody = (await numeric.json()) as { result: { protocolVersion: unknown } };
    expect(numericBody.result.protocolVersion).toBe("2025-06-18");
    expect(typeof numericBody.result.protocolVersion).toBe("string");
  });

  it("a notification (no id) returns 202 with no body", async () => {
    const res = await worker.fetch(
      mcpRequest({ jsonrpc: "2.0", method: "initialized" }, AUTH),
      ENV,
    );
    expect(res.status).toBe(202);
  });

  it("caps batch size instead of making unbounded prism calls from one request", async () => {
    stubFetch({ ok: true }, 200);
    const batch = Array.from({ length: 51 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }));
    const res = await worker.fetch(mcpRequest(batch, AUTH), ENV);
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error).toBeDefined();
    expect(body.error.message).toMatch(/51/);
    expect(calls).toHaveLength(0);
  });

  it("a batch element that throws mid-read does not discard earlier computed responses", async () => {
    stubFetchWithStream(throwingStream(), 200, { "content-type": "text/plain" });
    const batch = [
      { jsonrpc: "2.0", id: "a", method: "ping" },
      {
        jsonrpc: "2.0",
        id: "b",
        method: "tools/call",
        params: { name: "prism_request_read", arguments: { method: "GET", path: "/api/whatever" } },
      },
      { jsonrpc: "2.0", id: "c", method: "ping" },
    ];
    const res = await worker.fetch(mcpRequest(batch, AUTH), ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((r) => r.id)).toEqual(["a", "b", "c"]);
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

  it("chat forwards the trimmed model/user_input it validated, not the untrimmed originals", async () => {
    stubFetch({ id: 1, output: "hi" }, 200);
    await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 10,
          method: "tools/call",
          params: { name: "chat", arguments: { model: "  gpt-x  ", user_input: " hello " } },
        },
        AUTH,
      ),
      ENV,
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ model: "gpt-x", user_input: "hello" });
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

  it("prism_request_read escape hatch", async () => {
    stubFetch({ ok: true }, 200);
    await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 15,
          method: "tools/call",
          params: {
            name: "prism_request_read",
            arguments: { method: "GET", path: "/api/prefs" },
          },
        },
        AUTH,
      ),
      ENV,
    );
    expect(calls[0].url).toBe("https://play.example.com/api/prefs");
  });

  it("prism_request_read refuses a write method", async () => {
    const res = await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 15,
          method: "tools/call",
          params: {
            name: "prism_request_read",
            arguments: { method: "DELETE", path: "/api/projects/3" },
          },
        },
        AUTH,
      ),
      ENV,
    );
    const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/invalid method/);
    expect(calls).toHaveLength(0);
  });

  it("prism_request (write alias) refuses GET", async () => {
    const res = await worker.fetch(
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
    const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/invalid method/);
    expect(calls).toHaveLength(0);
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

  it("create_project enforces its own declared required 'name'", async () => {
    const res = await worker.fetch(
      mcpRequest(
        { jsonrpc: "2.0", id: 17, method: "tools/call", params: { name: "create_project", arguments: {} } },
        AUTH,
      ),
      ENV,
    );
    const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/name/);
    expect(calls).toHaveLength(0);
  });

  it("import_discord enforces its own declared required 'body'", async () => {
    const res = await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 18,
          method: "tools/call",
          params: { name: "import_discord", arguments: { project_id: 1 } },
        },
        AUTH,
      ),
      ENV,
    );
    const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/body/);
    expect(calls).toHaveLength(0);
  });

  it("get_artifact stops reading an image once it crosses the inline cap, not after buffering it whole", async () => {
    const tracker = { pulls: 0 };
    // 10 x 1MB chunks = 10MB total; the 4MB cap is crossed on the 5th chunk.
    stubFetchWithStream(countingChunkStream(1_000_000, 10, tracker), 200, {
      "content-type": "image/png",
    });
    const res = await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 19,
          method: "tools/call",
          params: { name: "get_artifact", arguments: { key: "out/big.png" } },
        },
        AUTH,
      ),
      ENV,
    );
    const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.content[0].text).toMatch(/inline cap/);
    // Proves the reader stopped near the 5th chunk instead of draining all 10:
    // a regression to buffer-then-check would pull all 10 (plus a closing call).
    expect(tracker.pulls).toBeLessThanOrEqual(6);
  });

  it("a body-read failure (image) becomes an isError result, not a thrown exception", async () => {
    stubFetchWithStream(throwingStream(), 200, { "content-type": "image/png" });
    const res = await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 20,
          method: "tools/call",
          params: { name: "get_artifact", arguments: { key: "out/broken.png" } },
        },
        AUTH,
      ),
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/upstream reset/);
  });

  it("a body-read failure (generic text) becomes an isError result, not a thrown exception", async () => {
    stubFetchWithStream(throwingStream(), 200, { "content-type": "text/plain" });
    const res = await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 21,
          method: "tools/call",
          params: { name: "prism_request_read", arguments: { method: "GET", path: "/api/whatever" } },
        },
        AUTH,
      ),
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/upstream reset/);
  });

  it("a body-read failure (SSE) does not throw, and returns whatever was read before the break", async () => {
    stubFetchWithStream(throwingStream(), 200, { "content-type": "text/event-stream" });
    const res = await worker.fetch(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 22,
          method: "tools/call",
          params: {
            name: "chat_stream",
            arguments: { model: "streaming-model", user_input: "hi" },
          },
        },
        AUTH,
      ),
      ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { content: { text: string }[] } };
    expect(body.result.content[0].text).toMatch(/SSE read failed/);
  });
});

describe("prismUrl mount boundary", () => {
  it("stays within a path-prefixed PRISM_URL mount for a normal path", () => {
    const env: McpEnv = { PRISM_URL: "https://tenant.example/prism" };
    expect(prismUrl(env, { method: "GET", path: "/api/history" })).toBe(
      "https://tenant.example/prism/api/history",
    );
  });

  it("refuses a path that normalizes outside a path-prefixed PRISM_URL mount", () => {
    const env: McpEnv = { PRISM_URL: "https://tenant.example/prism" };
    expect(() => prismUrl(env, { method: "GET", path: "/../../admin/keys" })).toThrow(/escapes/);
  });

  it("bare-host PRISM_URL (the documented deployment) is unaffected by the mount guard", () => {
    const env: McpEnv = { PRISM_URL: "https://play.example.com" };
    // Nothing to escape into above the origin root; this matches prior behavior.
    expect(prismUrl(env, { method: "GET", path: "/../../admin/keys" })).toBe(
      "https://play.example.com/admin/keys",
    );
  });
});
