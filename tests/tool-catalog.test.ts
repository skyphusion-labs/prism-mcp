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
  "compact_conversation",
  "clear_conversation_compact",
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

// The complete set of tools that either irreversibly discard data
// (delete_history / delete_conversation / delete_document / delete_project),
// irreversibly discard a stored credential (update_prefs' clear_* fields), or
// CAN do either of those at runtime because the method/path are arguments
// rather than fixed (prism_request). Kept as its own named list, checked
// against TOOLS by a derived filter below, so the two can disagree loudly
// instead of one hand-maintained list silently drifting from the other.
const DESTRUCTIVE_TOOLS = [
  "delete_history",
  "delete_conversation",
  "delete_document",
  "delete_project",
  "update_prefs",
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

describe("tool annotations (MCP 2025-06-18 readOnlyHint / destructiveHint / idempotentHint)", () => {
  it("every tool declares annotations", () => {
    for (const t of TOOLS) {
      expect(t.annotations, `${t.name} has no annotations`).toBeDefined();
    }
  });

  it("marks exactly the known-destructive tools as destructiveHint:true", () => {
    const destructive = TOOLS.filter((t) => t.annotations?.destructiveHint === true)
      .map((t) => t.name)
      .sort();
    expect(destructive).toEqual([...DESTRUCTIVE_TOOLS].sort());
  });

  it("a readOnlyHint:true tool is never also destructiveHint:true", () => {
    for (const t of TOOLS) {
      if (t.annotations?.readOnlyHint) {
        expect(t.annotations.destructiveHint, `${t.name} is readOnly and destructive`).toBe(false);
      }
    }
  });

  it("read-only GET tools (no side effects) are all marked readOnlyHint:true", () => {
    // Positive control for the annotations coverage test above: every GET-only
    // list/get tool should be auto-approvable by a client. If this drops below
    // the full read-only population, a new read tool shipped unannotated.
    const readOnlyExpected = [
      "health",
      "health_deep",
      "list_models",
      "get_prefs",
      "list_history",
      "get_history",
      "list_conversations",
      "get_conversation",
      "list_documents",
      "get_document",
      "poll_import",
      "list_projects",
      "get_project",
      "poll_job",
      "get_artifact",
    ];
    for (const name of readOnlyExpected) {
      const t = TOOLS.find((x) => x.name === name);
      expect(t?.annotations?.readOnlyHint, `${name} should be readOnlyHint:true`).toBe(true);
    }
  });
});
