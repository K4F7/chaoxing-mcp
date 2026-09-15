import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const LAUNCH_LINES = [
  '[mcp_servers.chaoxing]',
  'command = "npm"',
  'args = ["start", "--silent", "--prefix", "packages/chaoxing-mcp"]',
  "startup_timeout_sec = 60",
];

describe("MCP grok config", () => {
  test("README, docs/mcp.md, and .grok/config.toml share the same launch command", () => {
    const grok = readFileSync(join(repoRoot, ".grok/config.toml"), "utf8");
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    const docs = readFileSync(join(repoRoot, "docs/mcp.md"), "utf8");

    for (const line of LAUNCH_LINES) {
      assert.equal(grok.includes(line), true, line);
      assert.equal(readme.includes(line), true, line);
      assert.equal(docs.includes(line), true, line);
    }
    assert.equal(docs.includes("list_todos"), true);
    assert.equal(readme.includes("list_todos"), true);
  });
});
