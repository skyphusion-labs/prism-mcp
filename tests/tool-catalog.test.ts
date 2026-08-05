// Catalog coverage: every prism /api/* surface from the router has a tool or
// is documented as out of scope (WebSocket STT, account delete).

import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/mcp-tools.js";

const REQUIRED_TOOLS = [
  "health",
  "health_deep",
  "list_models",
  "get_prefs",
  "update_prefs",
  "chat",
  "chat_stream",
  "tts",
  "list_history",
  "get_history",
  "delete_history",
  "list_conversations",
  "get_conversation",
  "delete_conversation",
  "move_conversation_to_project",
  "list_documents",
  "get_document",
  "upload_document",
  "delete_document",
  "poll_import",
  "list_projects",
  "get_project",
  "create_project",
  "update_project",
  "delete_project",
  "add_project_document",
  "remove_project_document",
  "import_discord",
  "poll_job",
  "get_artifact",
  "prism_request",
] as const;

describe("tool catalog", () => {
  it("has unique names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("covers the prism HTTP API surface", () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const n of REQUIRED_TOOLS) {
      expect(names.has(n), `missing tool ${n}`).toBe(true);
    }
  });

  it("chat_stream collects SSE", () => {
    const t = TOOLS.find((x) => x.name === "chat_stream");
    expect(t?.collectSse).toBe(true);
  });

  it("get_artifact inlines images", () => {
    const t = TOOLS.find((x) => x.name === "get_artifact");
    expect(t?.inlineImages).toBe(true);
  });
});
