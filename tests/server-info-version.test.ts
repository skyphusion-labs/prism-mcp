// Wire-visible serverInfo.version must equal package.json version.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoFile = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

function serverInfoVersionFromSource(): string | null {
  const src = repoFile("src/mcp.ts");
  const m = src.match(/const SERVER_INFO = \{[^}]*version:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

describe("serverInfo.version tracks package.json", () => {
  it("finds the literal", () => {
    expect(serverInfoVersionFromSource()).not.toBeNull();
  });

  it("matches the published package version", () => {
    const pkg = JSON.parse(repoFile("package.json")) as { version: string };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(serverInfoVersionFromSource()).toBe(pkg.version);
  });

  it("matcher discriminates a constructed mismatch", () => {
    const offender = 'const SERVER_INFO = { name: "prism", version: "9.9.9" };';
    const m = offender.match(/const SERVER_INFO = \{[^}]*version:\s*"([^"]+)"/);
    expect(m?.[1]).toBe("9.9.9");
    expect(m?.[1]).not.toBe(JSON.parse(repoFile("package.json")).version);
  });
});
