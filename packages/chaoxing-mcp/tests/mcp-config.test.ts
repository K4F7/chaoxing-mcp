import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const LAUNCH_LINES = [
  '[mcp_servers.chaoxing]',
  'command = "npm"',
  'args = ["start", "--silent", "--prefix", "packages/chaoxing-mcp"]',
  "startup_timeout_sec = 60",
];

const OLD_NPM_SCOPE = "@" + "chaoxinghelper/";
const OLD_CLONE = "K4F7/" + "chaoxinghelper";
const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".dart_tool",
  "build",
  "coverage",
]);
const SKIP_LOCK_NAMES = new Set([
  "package-lock.json",
  "pubspec.lock",
  "uv.lock",
]);
const ARCHIVAL_BUN_DOC_PREFIXES = [`docs${sep}superpowers${sep}`];
const BUN = "bu" + "n";
const BUN_LOCK = `${BUN}.lock`;
const TYPES_BUN = `@types/${BUN}`;
const BUN_REFERENCE = new RegExp(`\\b${BUN}\\b`, "i");

function readJson(relativePath: string): { name: string } {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as {
    name: string;
  };
}

function shouldSkipFile(relativePath: string): boolean {
  const parts = relativePath.split(sep);
  const base = parts.at(-1) ?? "";
  if (SKIP_LOCK_NAMES.has(base)) {
    return true;
  }
  if (relativePath.includes(`${sep}android${sep}src${sep}main${sep}java${sep}`)) {
    return true;
  }
  return false;
}

function collectTextFiles(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTextFiles(full, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = relative(repoRoot, full);
    if (shouldSkipFile(relativePath)) {
      continue;
    }
    files.push(full);
  }
}

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

  test("npm names and docs use chaoxing-mcp without leftover helper scope or clone URL", () => {
    assert.equal(readJson("package.json").name, "chaoxing-mcp");
    assert.equal(readJson("packages/chaoxing-mcp/package.json").name, "@chaoxing-mcp/mcp");
    assert.equal(
      readJson("packages/chaoxing-domain/package.json").name,
      "@chaoxing-mcp/domain",
    );
    assert.equal(
      readJson("packages/chaoxing-android-alarms/package.json").name,
      "@chaoxing-mcp/android-alarms",
    );
    assert.equal(
      readJson("packages/chaoxing-android-http/package.json").name,
      "@chaoxing-mcp/android-http",
    );

    const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
    assert.equal(agents.includes("K4F7/chaoxing-mcp"), true);
    assert.equal(agents.includes(OLD_CLONE), false);

    const leftovers: string[] = [];
    const files: string[] = [];
    collectTextFiles(repoRoot, files);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (text.includes(OLD_NPM_SCOPE) || text.includes(OLD_CLONE)) {
        leftovers.push(relative(repoRoot, file));
      }
    }
    assert.deepEqual(leftovers, []);
  });

  test("runtime, scripts, and current docs do not depend on Bun", () => {
    assert.equal(existsSync(join(repoRoot, BUN_LOCK)), false);

    const rootPkg = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    assert.equal(TYPES_BUN in (rootPkg.dependencies ?? {}), false);
    assert.equal(TYPES_BUN in (rootPkg.devDependencies ?? {}), false);
    for (const [name, command] of Object.entries(rootPkg.scripts)) {
      assert.equal(
        command.includes(BUN),
        false,
        `${name}: ${command}`,
      );
    }

    const tsconfig = JSON.parse(
      readFileSync(join(repoRoot, "tsconfig.json"), "utf8"),
    ) as { compilerOptions?: { types?: string[] } };
    assert.equal((tsconfig.compilerOptions?.types ?? []).includes(BUN), false);

    const leftovers: string[] = [];
    const files: string[] = [];
    collectTextFiles(repoRoot, files);
    for (const file of files) {
      const relativePath = relative(repoRoot, file);
      if (ARCHIVAL_BUN_DOC_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
        continue;
      }
      if (relativePath === `packages${sep}chaoxing-mcp${sep}tests${sep}mcp-config.test.ts`) {
        continue;
      }
      const text = readFileSync(file, "utf8");
      if (BUN_REFERENCE.test(text)) {
        leftovers.push(relativePath);
      }
    }
    assert.deepEqual(leftovers, []);

    const currentDocs = [
      "README.md",
      "docs/mcp.md",
      "docs/agents/domain.md",
      "docs/agents/issue-tracker.md",
      "docs/agents/triage-labels.md",
      "AGENTS.md",
    ];
    for (const relativePath of currentDocs) {
      const text = readFileSync(join(repoRoot, relativePath), "utf8");
      assert.equal(
        new RegExp(`\\b${BUN}\\b`, "i").test(text),
        false,
        relativePath,
      );
    }
  });

  test("keeps the existing keychain service and Playwright profile path", () => {
    const credentials = readFileSync(
      join(repoRoot, "packages/chaoxing-mcp/src/credentials.ts"),
      "utf8",
    );
    const openLogin = readFileSync(
      join(repoRoot, "packages/chaoxing-mcp/src/open-login.ts"),
      "utf8",
    );
    assert.match(credentials, /SERVICE = "chaoxinghelper\.mcp"/);
    assert.match(openLogin, /"\.chaoxinghelper", "chrome-profile"/);
  });

  test("exposes npm run login and never takes passwords in MCP tools", () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "packages/chaoxing-mcp/package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    assert.equal(pkg.scripts.login, "node --import tsx src/login-cli.ts");

    const server = readFileSync(
      join(repoRoot, "packages/chaoxing-mcp/src/server.ts"),
      "utf8",
    );
    assert.match(server, /list_todos/);
    assert.doesNotMatch(server, /CHAOXING_PASSWORD/);
    assert.doesNotMatch(server, /username:\s*z\./);
    assert.doesNotMatch(server, /password:\s*z\./);

    const docs = readFileSync(join(repoRoot, "docs/mcp.md"), "utf8");
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    assert.match(docs, /npm run login --silent/);
    assert.match(readme, /npm run login --silent/);
    assert.doesNotMatch(docs, /npm run login -- -u .* -p /);
  });
});
