// Env bindings for @skyphusion-labs/prism-mcp.
//
// Deploy as a separate Worker (wrangler.mcp.toml.example). Pure HTTP proxy to a
// prism instance; no D1/R2/AI bindings on this Worker.

export interface McpEnv {
  /**
   * Base URL of the prism Worker, e.g. "https://play.skyphusion.org".
   * A [vars] entry (public hostname). No trailing slash required.
   */
  PRISM_URL?: string;

  /**
   * Prism session token (the raw cookie value for `__Host-prism_session`).
   * Worker SECRET. Public-mode prism (AUTH_MODE=public) requires a logged-in
   * session; seed once out-of-band (login via the SPA or POST /api/auth/login,
   * copy the cookie value, wrangler secret put PRISM_SESSION). Never a var.
   * When unset, every tool call fails closed unless PRISM_ACCESS_EMAIL is set
   * for access-mode / local-dev targets.
   */
  PRISM_SESSION?: string;

  /**
   * Optional identity header for access-mode prism (self-host with
   * Cf-Access-Authenticated-User-Email trust, or ACCESS_ALLOW_ANONYMOUS local
   * is not enough for a real user). When set, sent as
   * `Cf-Access-Authenticated-User-Email`. Prefer PRISM_SESSION for public play.
   */
  PRISM_ACCESS_EMAIL?: string;

  /**
   * Optional Cloudflare Access service-token headers for calling a prism that
   * sits behind Access. Pair with PRISM_ACCESS_CLIENT_SECRET.
   */
  PRISM_ACCESS_CLIENT_ID?: string;
  PRISM_ACCESS_CLIENT_SECRET?: string;

  /**
   * MCP gate. Every /mcp request must present `Authorization: Bearer <MCP_TOKEN>`.
   * Worker SECRET. Distinct from the prism session so the agent never learns
   * the user's prism cookie in normal use, and the two rotate independently.
   * Unset => fail closed. Caveat: `prism_request` is a generic escape hatch
   * that relays whatever body the target prism path returns, unfiltered; a
   * prism route that reflects session material into a response body would
   * still reach the agent through that path (see docs/mcp.md "Security
   * boundary"). This server does not filter prism_request output.
   */
  MCP_TOKEN?: string;
}
