// Prism MCP -- tool catalog + dispatch.
//
// Each curated tool maps to one prism route (CLAUDE.md "Routes reference" in
// skyphusion-labs/prism). `prism_request` is the escape hatch for any other path.
// Stateless: long jobs are agent-driven via poll_job / poll_import.
//
// Auth to prism: Cookie __Host-prism_session (PRISM_SESSION secret), optional
// Access identity / service-token headers. The MCP client only presents MCP_TOKEN.

import type { McpEnv } from "./mcp-env.js";

/** Cookie name prism public mode uses (src/session.ts). */
export const PRISM_SESSION_COOKIE = "__Host-prism_session";

export type PrismCall = {
  method: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Return image bytes as MCP image blocks when prism streams an image/* body. */
  inlineImages?: boolean;
  /** Drain text/event-stream into a single text result (chat_stream). */
  collectSse?: boolean;
  build(args: Record<string, unknown>): PrismCall;
}

const OBJ = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({ type: "object", properties, required });

const STR = (description: string) => ({ type: "string", description });
const NUM = (description: string) => ({ type: "number", description });
const BOOL = (description: string) => ({ type: "boolean", description });

function reqStr(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`missing required argument '${key}'`);
  }
  return v.trim();
}

function optNum(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`'${key}' must be a number`);
  return n;
}

function reqNum(args: Record<string, unknown>, key: string): number {
  const n = optNum(args, key);
  if (n === undefined) throw new Error(`missing required argument '${key}'`);
  return n;
}

/** Path segment for artifact keys (preserve slashes, encode segments, refuse traversal). */
function artifactKeyPath(raw: string): string {
  if (raw.startsWith("/") || raw.includes("://") || raw.split("/").includes("..")) {
    throw new Error(`invalid artifact key '${raw}'`);
  }
  return raw.split("/").map(encodeURIComponent).join("/");
}

function bodyMinus(
  args: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const k of keys) delete out[k];
  return out;
}

function parseBodyArg(body: unknown): unknown {
  if (typeof body === "string" && body.trim() !== "") {
    try {
      return JSON.parse(body);
    } catch {
      throw new Error("body must be a JSON object (or a JSON-encoded string that parses to one)");
    }
  }
  return body;
}

// ---------------------------------------------------------------------------
// Tool catalog (one tool, one route; full prism /api/* surface)
// ---------------------------------------------------------------------------

export const TOOLS: McpTool[] = [
  // --- health ----------------------------------------------------------------
  {
    name: "health",
    description: "Prism liveness probe (GET /health). No auth required on prism.",
    inputSchema: OBJ({}),
    build: () => ({ method: "GET", path: "/health" }),
  },
  {
    name: "health_deep",
    description:
      "Prism deep health (GET /health/deep): D1, R2, Vectorize, gateway config. May return 503.",
    inputSchema: OBJ({}),
    build: () => ({ method: "GET", path: "/health/deep" }),
  },

  // --- models / prefs --------------------------------------------------------
  {
    name: "list_models",
    description:
      "List prism catalog models (GET /api/models). Returns models, auth mode, gateway/control-plane status. " +
      "Boot probe is public on prism; still sent with session when configured.",
    inputSchema: OBJ({}),
    build: () => ({ method: "GET", path: "/api/models" }),
  },
  {
    name: "get_prefs",
    description:
      "Get the session user's AI Gateway / control-plane prefs (GET /api/prefs). Tokens are masked.",
    inputSchema: OBJ({}),
    build: () => ({ method: "GET", path: "/api/prefs" }),
  },
  {
    name: "update_prefs",
    description:
      "Patch gateway or control-plane prefs (PATCH /api/prefs). " +
      "Fields: gateway_id, cf_aig_token, clear_cf_aig_token, control_plane_key (pcp_…), clear_control_plane_key.",
    inputSchema: OBJ({
      gateway_id: STR("AI Gateway slug."),
      cf_aig_token: STR("Unified Billing / gateway token (stored encrypted server-side)."),
      clear_cf_aig_token: BOOL("When true, clear the stored gateway token."),
      control_plane_key: STR("prism-control-plane client key (pcp_<16 hex>_<43 base64url>)."),
      clear_control_plane_key: BOOL("When true, clear the control-plane key."),
    }),
    build: (a) => ({ method: "PATCH", path: "/api/prefs", body: a }),
  },

  // --- generation ------------------------------------------------------------
  {
    name: "chat",
    description:
      "Run a prism model turn (POST /api/chat). Dispatches by model.type: chat, image, tts, video, stt, music. " +
      "Required: model, user_input. Optional: system_prompt, conversation_id, project_id, use_docs, use_web_search, " +
      "attachments, image_url, image_key. Persists history. Long video/music jobs return a job id; poll with poll_job. " +
      "Live voice models use WebSocket /api/stt/stream (not available as an MCP tool; use prism_request is not enough).",
    inputSchema: OBJ(
      {
        model: STR("Catalog model id from list_models."),
        user_input: STR("User prompt / text input for the model."),
        system_prompt: STR("Optional system prompt (project default applies when empty + project_id set)."),
        conversation_id: STR("Continue a multi-turn conversation."),
        project_id: NUM("Scope RAG + project system_prompt."),
        use_docs: BOOL("Retrieve RAG chunks from Vectorize and inject context."),
        use_web_search: BOOL("Query web search and inject snippets."),
        attachments: {
          type: "array",
          description:
            "Multimodal attachments (images/audio/docs). Same shape as the SPA: mime, data (base64/data-URL), key, text, filename, etc.",
        },
        image_url: STR("Fetchable source image URL (image-to-video)."),
        image_key: STR("R2 artifact key for prior image (image-to-video chaining)."),
      },
      ["model", "user_input"],
    ),
    build: (a) => {
      reqStr(a, "model");
      reqStr(a, "user_input");
      return { method: "POST", path: "/api/chat", body: a };
    },
  },
  {
    name: "chat_stream",
    description:
      "Streaming chat (POST /api/chat/stream). Only for catalog entries with streaming: true. " +
      "The MCP drains the SSE body into one text result (agents cannot hold open SSE). Prefer chat when stream is not required.",
    inputSchema: OBJ(
      {
        model: STR("Streaming-capable chat model id."),
        user_input: STR("User prompt."),
        system_prompt: STR("Optional system prompt."),
        conversation_id: STR("Continue a conversation."),
        project_id: NUM("Project scope."),
        use_docs: BOOL("RAG retrieval."),
        use_web_search: BOOL("Web search context."),
        attachments: { type: "array", description: "Optional multimodal attachments." },
      },
      ["model", "user_input"],
    ),
    collectSse: true,
    build: (a) => {
      reqStr(a, "model");
      reqStr(a, "user_input");
      return { method: "POST", path: "/api/chat/stream", body: a };
    },
  },
  {
    name: "tts",
    description:
      "Synthesize speech without a chats row (POST /api/tts). Body: model (tts catalog id) + text (or user_input). " +
      "Returns audio bytes (summarized unless small enough); for history-backed TTS use chat with a tts model.",
    inputSchema: OBJ(
      {
        model: STR("TTS model id from list_models (type tts)."),
        text: STR("Text to speak."),
        user_input: STR("Alias for text (either text or user_input required)."),
      },
      ["model"],
    ),
    build: (a) => {
      const text =
        typeof a.text === "string" && a.text.trim()
          ? a.text
          : typeof a.user_input === "string"
            ? a.user_input
            : "";
      if (!text.trim()) throw new Error("missing required argument 'text' (or user_input)");
      return {
        method: "POST",
        path: "/api/tts",
        body: { model: reqStr(a, "model"), text, user_input: text },
      };
    },
  },

  // --- history ---------------------------------------------------------------
  {
    name: "list_history",
    description: "List the session user's chat history, newest first (GET /api/history).",
    inputSchema: OBJ({
      limit: NUM("Optional page size if prism supports it (forwarded as query)."),
      offset: NUM("Optional offset."),
    }),
    build: (a) => ({
      method: "GET",
      path: "/api/history",
      query: { limit: optNum(a, "limit"), offset: optNum(a, "offset") },
    }),
  },
  {
    name: "get_history",
    description: "One history row with attachments + output (GET /api/history/:id).",
    inputSchema: OBJ({ id: NUM("History row id.") }, ["id"]),
    build: (a) => ({ method: "GET", path: `/api/history/${reqNum(a, "id")}` }),
  },
  {
    name: "delete_history",
    description: "Delete a history row and its R2 objects (DELETE /api/history/:id).",
    inputSchema: OBJ({ id: NUM("History row id.") }, ["id"]),
    build: (a) => ({ method: "DELETE", path: `/api/history/${reqNum(a, "id")}` }),
  },

  // --- conversations ---------------------------------------------------------
  {
    name: "list_conversations",
    description: "List conversations grouped by conversation_id (GET /api/conversations).",
    inputSchema: OBJ({}),
    build: () => ({ method: "GET", path: "/api/conversations" }),
  },
  {
    name: "get_conversation",
    description: "Full transcript for a conversation (GET /api/conversations/:id).",
    inputSchema: OBJ({ id: STR("conversation_id.") }, ["id"]),
    build: (a) => ({
      method: "GET",
      path: `/api/conversations/${encodeURIComponent(reqStr(a, "id"))}`,
    }),
  },
  {
    name: "delete_conversation",
    description: "Cascade-delete a conversation's turns + R2 artifacts (DELETE /api/conversations/:id).",
    inputSchema: OBJ({ id: STR("conversation_id.") }, ["id"]),
    build: (a) => ({
      method: "DELETE",
      path: `/api/conversations/${encodeURIComponent(reqStr(a, "id"))}`,
    }),
  },
  {
    name: "move_conversation_to_project",
    description:
      "Move a conversation into a project or clear project (PATCH /api/conversations/:id/project). " +
      "Body: { project_id: number | null }.",
    inputSchema: OBJ(
      {
        id: STR("conversation_id."),
        project_id: {
          description: "Target project id, or null to unassign.",
          anyOf: [{ type: "number" }, { type: "null" }],
        },
      },
      ["id", "project_id"],
    ),
    build: (a) => {
      const id = reqStr(a, "id");
      if (!("project_id" in a)) throw new Error("missing required argument 'project_id'");
      const pid = a.project_id;
      if (pid !== null && typeof pid !== "number") {
        throw new Error("project_id must be a number or null");
      }
      return {
        method: "PATCH",
        path: `/api/conversations/${encodeURIComponent(id)}/project`,
        body: { project_id: pid },
      };
    },
  },
  {
    name: "compact_conversation",
    description:
      "Summarize older turns for model context (POST /api/conversations/:id/compact, prism v0.175.7+). " +
      "UI transcript stays full; next chat calls inject the summary + keep_recent raw turns. " +
      "Optional body: model (summarizer), keep_recent (default 2).",
    inputSchema: OBJ(
      {
        id: STR("conversation_id."),
        model: STR("Optional chat model id for the summary turn."),
        keep_recent: NUM("How many recent turns to keep raw (default 2)."),
      },
      ["id"],
    ),
    build: (a) => {
      const id = reqStr(a, "id");
      const body: Record<string, unknown> = {};
      if (typeof a.model === "string" && a.model.trim()) body.model = a.model.trim();
      const kr = optNum(a, "keep_recent");
      if (kr !== undefined) body.keep_recent = kr;
      return {
        method: "POST",
        path: `/api/conversations/${encodeURIComponent(id)}/compact`,
        body: Object.keys(body).length ? body : {},
      };
    },
  },
  {
    name: "clear_conversation_compact",
    description:
      "Clear compact summary so the next turn uses full history again " +
      "(DELETE /api/conversations/:id/compact).",
    inputSchema: OBJ({ id: STR("conversation_id.") }, ["id"]),
    build: (a) => ({
      method: "DELETE",
      path: `/api/conversations/${encodeURIComponent(reqStr(a, "id"))}/compact`,
    }),
  },

  // --- documents / RAG -------------------------------------------------------
  {
    name: "list_documents",
    description: "List RAG documents (GET /api/documents). Optional ?project_id=N filter.",
    inputSchema: OBJ({ project_id: NUM("Only docs attached to this project.") }),
    build: (a) => ({
      method: "GET",
      path: "/api/documents",
      query: { project_id: optNum(a, "project_id") },
    }),
  },
  {
    name: "get_document",
    description: "Document metadata + chunk preview (GET /api/documents/:id).",
    inputSchema: OBJ({ id: NUM("Document id.") }, ["id"]),
    build: (a) => ({ method: "GET", path: `/api/documents/${reqNum(a, "id")}` }),
  },
  {
    name: "upload_document",
    description:
      "Upload + chunk + embed a document for RAG (POST /api/documents). " +
      "JSON body: filename, mime, data (base64 or data-URL). Zip files expand asynchronously; poll poll_import.",
    inputSchema: OBJ(
      {
        filename: STR("Original filename."),
        mime: STR("MIME type (default text/plain)."),
        data: STR("Base64 file bytes or data: URL."),
      },
      ["data"],
    ),
    build: (a) => ({
      method: "POST",
      path: "/api/documents",
      body: {
        filename: typeof a.filename === "string" ? a.filename : "untitled.txt",
        mime: typeof a.mime === "string" ? a.mime : "text/plain",
        data: reqStr(a, "data"),
      },
    }),
  },
  {
    name: "delete_document",
    description: "Cascade-delete document, chunks, vectors, R2 (DELETE /api/documents/:id).",
    inputSchema: OBJ({ id: NUM("Document id.") }, ["id"]),
    build: (a) => ({ method: "DELETE", path: `/api/documents/${reqNum(a, "id")}` }),
  },
  {
    name: "poll_import",
    description: "Poll a durable zip RAG import workflow (GET /api/import/:id).",
    inputSchema: OBJ({ id: STR("Import workflow instance id.") }, ["id"]),
    build: (a) => ({
      method: "GET",
      path: `/api/import/${encodeURIComponent(reqStr(a, "id"))}`,
    }),
  },

  // --- projects --------------------------------------------------------------
  {
    name: "list_projects",
    description: "List projects with document counts (GET /api/projects).",
    inputSchema: OBJ({}),
    build: () => ({ method: "GET", path: "/api/projects" }),
  },
  {
    name: "get_project",
    description: "Get one project + members/docs (GET /api/projects/:id).",
    inputSchema: OBJ({ id: NUM("Project id.") }, ["id"]),
    build: (a) => ({ method: "GET", path: `/api/projects/${reqNum(a, "id")}` }),
  },
  {
    name: "create_project",
    description: "Create a project (POST /api/projects). Body: name, optional description, system_prompt.",
    inputSchema: OBJ(
      {
        name: STR("Display name."),
        description: STR("Optional description."),
        system_prompt: STR("Default system prompt for chat in this project."),
      },
      ["name"],
    ),
    build: (a) => ({ method: "POST", path: "/api/projects", body: a }),
  },
  {
    name: "update_project",
    description: "Update name / description / system_prompt (PATCH /api/projects/:id).",
    inputSchema: OBJ(
      {
        id: NUM("Project id."),
        name: STR("New name."),
        description: STR("New description."),
        system_prompt: STR("New system prompt."),
      },
      ["id"],
    ),
    build: (a) => ({
      method: "PATCH",
      path: `/api/projects/${reqNum(a, "id")}`,
      body: bodyMinus(a, "id"),
    }),
  },
  {
    name: "delete_project",
    description: "Delete a project (docs are kept) (DELETE /api/projects/:id).",
    inputSchema: OBJ({ id: NUM("Project id.") }, ["id"]),
    build: (a) => ({ method: "DELETE", path: `/api/projects/${reqNum(a, "id")}` }),
  },
  {
    name: "add_project_document",
    description: "Attach a document to a project (POST /api/projects/:pid/documents/:did).",
    inputSchema: OBJ(
      { project_id: NUM("Project id."), document_id: NUM("Document id.") },
      ["project_id", "document_id"],
    ),
    build: (a) => ({
      method: "POST",
      path: `/api/projects/${reqNum(a, "project_id")}/documents/${reqNum(a, "document_id")}`,
    }),
  },
  {
    name: "remove_project_document",
    description: "Detach a document from a project (DELETE /api/projects/:pid/documents/:did).",
    inputSchema: OBJ(
      { project_id: NUM("Project id."), document_id: NUM("Document id.") },
      ["project_id", "document_id"],
    ),
    build: (a) => ({
      method: "DELETE",
      path: `/api/projects/${reqNum(a, "project_id")}/documents/${reqNum(a, "document_id")}`,
    }),
  },
  {
    name: "import_discord",
    description:
      "Import a DiscordChatExporter JSON export into a project (POST /api/projects/:id/import-discord). " +
      "Body shape matches the SPA (export payload).",
    inputSchema: OBJ(
      {
        project_id: NUM("Target project id."),
        body: {
          type: ["object", "string"],
          description: "Import payload (object, or JSON-encoded string).",
        },
      },
      ["project_id", "body"],
    ),
    build: (a) => ({
      method: "POST",
      path: `/api/projects/${reqNum(a, "project_id")}/import-discord`,
      body: parseBodyArg(a.body),
    }),
  },

  // --- jobs / artifacts ------------------------------------------------------
  {
    name: "poll_job",
    description: "Poll an async video/music job (GET /api/job/:id). Reads the chats row status.",
    inputSchema: OBJ({ id: NUM("Job / chat row id.") }, ["id"]),
    build: (a) => ({ method: "GET", path: `/api/job/${reqNum(a, "id")}` }),
  },
  {
    name: "get_artifact",
    description:
      "Stream an R2 artifact the session owns (GET /api/artifact/*). " +
      "Images may return as MCP image blocks; other binary is summarized. key is the R2 key path without leading slash.",
    inputSchema: OBJ({ key: STR("R2 key, e.g. 'outputs/usr_…/img.png'.") }, ["key"]),
    inlineImages: true,
    build: (a) => ({
      method: "GET",
      path: `/api/artifact/${artifactKeyPath(reqStr(a, "key"))}`,
    }),
  },

  // --- escape hatch ----------------------------------------------------------
  {
    name: "prism_request",
    description:
      "Generic escape hatch to any prism path (method + path + optional query/JSON body). " +
      "Use for routes not covered by a curated tool (e.g. /api/auth/login). " +
      "path must start with '/'. Session cookie is still attached. Binary responses are summarized.",
    inputSchema: OBJ(
      {
        method: {
          type: "string",
          enum: ["GET", "POST", "PATCH", "PUT", "DELETE"],
          description: "HTTP method.",
        },
        path: STR("Path starting with '/', e.g. '/api/history'."),
        query: { type: "object", description: "Optional query params." },
        body: {
          type: ["object", "string"],
          description: "Optional JSON body (object or JSON-encoded string).",
        },
      },
      ["method", "path"],
    ),
    build: (a) => {
      const method = String(a.method ?? "").toUpperCase();
      if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) {
        throw new Error(`invalid method '${String(a.method)}'`);
      }
      const path = reqStr(a, "path");
      if (!path.startsWith("/")) throw new Error("path must start with '/'");
      const query =
        a.query && typeof a.query === "object"
          ? (a.query as Record<string, string | number | undefined>)
          : undefined;
      let body = a.body;
      if (body !== undefined) body = parseBodyArg(body);
      return { method, path, query, body };
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// HTTP to prism
// ---------------------------------------------------------------------------

export function prismUrl(env: McpEnv, call: PrismCall): string {
  const base = (env.PRISM_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("PRISM_URL is not configured");
  const url = new URL(base + call.path);
  if (call.query) {
    for (const [k, v] of Object.entries(call.query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function authConfigured(env: McpEnv): boolean {
  return !!(env.PRISM_SESSION?.trim() || env.PRISM_ACCESS_EMAIL?.trim());
}

function buildPrismHeaders(env: McpEnv): Record<string, string> {
  const headers: Record<string, string> = {};
  if (env.PRISM_SESSION?.trim()) {
    headers.Cookie = `${PRISM_SESSION_COOKIE}=${env.PRISM_SESSION.trim()}`;
  }
  if (env.PRISM_ACCESS_EMAIL?.trim()) {
    headers["Cf-Access-Authenticated-User-Email"] = env.PRISM_ACCESS_EMAIL.trim();
  }
  if (env.PRISM_ACCESS_CLIENT_ID?.trim() && env.PRISM_ACCESS_CLIENT_SECRET?.trim()) {
    headers["CF-Access-Client-Id"] = env.PRISM_ACCESS_CLIENT_ID.trim();
    headers["CF-Access-Client-Secret"] = env.PRISM_ACCESS_CLIENT_SECRET.trim();
  }
  return headers;
}

const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_SSE_CHARS = 512 * 1024;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function readSseText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "(empty stream)";
  const decoder = new TextDecoder();
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    if (raw.length > MAX_SSE_CHARS) {
      await reader.cancel();
      return raw.slice(0, MAX_SSE_CHARS) + "\n... (SSE truncated)";
    }
  }
  raw += decoder.decode();
  // Prefer concatenating data: text deltas when frames look like OpenAI/Anthropic SSE.
  const texts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
    if (payload === "[DONE]") continue;
    try {
      const j = JSON.parse(payload) as Record<string, unknown>;
      // OpenAI-style
      const choices = j.choices as Array<{ delta?: { content?: string }; text?: string }> | undefined;
      if (choices?.[0]?.delta?.content) texts.push(choices[0].delta.content);
      else if (choices?.[0]?.text) texts.push(choices[0].text);
      // Anthropic-style content_block_delta
      const delta = j.delta as { text?: string; type?: string } | undefined;
      if (delta?.text) texts.push(delta.text);
      // Prism/provider generic
      if (typeof j.text === "string") texts.push(j.text);
      if (typeof j.content === "string") texts.push(j.content);
    } catch {
      // non-JSON data line: keep raw
    }
  }
  if (texts.length) return texts.join("");
  return raw.length > 16_000 ? raw.slice(0, 16_000) + "\n... (truncated)" : raw;
}

export async function runTool(
  env: McpEnv,
  call: PrismCall,
  opts: { inlineImages?: boolean; collectSse?: boolean } = {},
): Promise<{ content: McpContent[]; isError: boolean }> {
  if (!authConfigured(env) && call.path.startsWith("/api/") && call.path !== "/api/models") {
    // /api/models is a public boot probe; other /api/* need a session in public mode.
    // health paths do not need prism auth.
    return {
      content: [
        {
          type: "text",
          text:
            "MCP is not configured for authenticated prism calls: set PRISM_SESSION " +
            "(cookie value for __Host-prism_session) and/or PRISM_ACCESS_EMAIL.",
        },
      ],
      isError: true,
    };
  }

  let url: string;
  try {
    url = prismUrl(env, call);
  } catch (err) {
    return { content: [{ type: "text", text: String(err) }], isError: true };
  }

  const headers = buildPrismHeaders(env);
  const init: RequestInit = { method: call.method, headers };
  const sendsBody = call.method !== "GET" && call.method !== "DELETE" && call.method !== "HEAD";
  if (call.body !== undefined && sendsBody) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(call.body);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return {
      content: [{ type: "text", text: `Prism request failed (transport): ${String(err)}` }],
      isError: true,
    };
  }

  const ct = res.headers.get("content-type") ?? "";
  const status = res.status;
  const isError = status >= 400;
  const line = `${call.method} ${call.path} -> ${status}`;

  if (opts.collectSse && /text\/event-stream/i.test(ct)) {
    const text = await readSseText(res);
    return { content: [{ type: "text", text: `${line}\n\n${text}` }], isError };
  }

  if (/application\/json/i.test(ct)) {
    let text: string;
    try {
      text = JSON.stringify(await res.json(), null, 2);
    } catch {
      text = "(unparseable JSON body)";
    }
    return { content: [{ type: "text", text: `${line}\n\n${text}` }], isError };
  }

  const isBinaryMedia =
    /^(?:video|image|audio)\//i.test(ct) ||
    /^application\/(?:octet-stream|x-tar|zip)/i.test(ct);

  if (isBinaryMedia) {
    const len = res.headers.get("content-length") ?? "unknown";
    if (opts.inlineImages && /^image\//i.test(ct) && !isError) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
        return {
          content: [
            {
              type: "text",
              text: `${line}\n\nImage is ${bytes.byteLength} bytes, over the ${MAX_INLINE_IMAGE_BYTES}-byte inline cap. Fetch via get_artifact or a shorter-lived client URL if available.`,
            },
          ],
          isError,
        };
      }
      const mimeType = ct.split(";")[0].trim();
      return {
        content: [
          { type: "text", text: `${line}\n\n${mimeType}, ${bytes.byteLength} bytes:` },
          { type: "image", data: toBase64(bytes), mimeType },
        ],
        isError,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `${line}\n\nBinary response (${ct}, ${len} bytes) not inlined. Use get_artifact with the R2 key from the chat/job JSON when available.`,
        },
      ],
      isError,
    };
  }

  const maxRead = 65_536;
  const cl = parseInt(res.headers.get("content-length") ?? "0", 10) || 0;
  if (cl > maxRead) {
    return {
      content: [{ type: "text", text: `${line}\n\nResponse too large (${cl} bytes); not inlined.` }],
      isError,
    };
  }
  const reader = res.body?.getReader();
  if (!reader) {
    return { content: [{ type: "text", text: `${line}\n\n(empty body)` }], isError };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxRead) {
      await reader.cancel();
      return {
        content: [{ type: "text", text: `${line}\n\nResponse too large (>${maxRead} bytes); not inlined.` }],
        isError,
      };
    }
    chunks.push(value);
  }
  const raw = new TextDecoder().decode(
    chunks.reduce((acc, c) => {
      const merged = new Uint8Array(acc.length + c.length);
      merged.set(acc);
      merged.set(c, acc.length);
      return merged;
    }, new Uint8Array()),
  );
  const capped = raw.length > 4000 ? raw.slice(0, 4000) + "\n... (truncated)" : raw;
  return { content: [{ type: "text", text: `${line}\n\n${capped}` }], isError };
}
