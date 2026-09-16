import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

import { applyDevVars, loadDevVars, parseDevVars, upsertDevVar } from "../src/dev-vars";

describe("dev vars", () => {
  const originalEnv = { ...process.env };
  let tempDir: string | undefined;

  afterEach(async () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  test("parses quoted and unquoted values", () => {
    assert.deepEqual(
      parseDevVars(`
# comment
CHAOXING_COOKIE="UID=1; route=abc"
RUN_TOKEN=plain-token
`),
      {
        CHAOXING_COOKIE: "UID=1; route=abc",
        RUN_TOKEN: "plain-token",
      },
    );
  });

  test("loadDevVars returns empty object when the file is missing", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dev-vars-"));
    const filePath = join(tempDir, ".dev.vars");

    assert.deepEqual(await loadDevVars(filePath), {});
  });

  test("applyDevVars loads file values into process.env without overwriting by default", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dev-vars-"));
    const filePath = join(tempDir, ".dev.vars");
    await writeFile(
      filePath,
      `CHAOXING_COOKIE="UID=from-file"\nHOME_URL=https://i.chaoxing.com/base\n`,
    );
    process.env.CHAOXING_COOKIE = "UID=existing";

    const vars = await applyDevVars(filePath);

    assert.equal(process.env.CHAOXING_COOKIE, "UID=existing");
    assert.equal(process.env.HOME_URL, "https://i.chaoxing.com/base");
    assert.deepEqual(vars, {
      CHAOXING_COOKIE: "UID=from-file",
      HOME_URL: "https://i.chaoxing.com/base",
    });
  });

  test("applyDevVars overwrites process.env when requested", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dev-vars-"));
    const filePath = join(tempDir, ".dev.vars");
    await writeFile(filePath, `CHAOXING_COOKIE="UID=from-file"\n`);
    process.env.CHAOXING_COOKIE = "UID=existing";

    await applyDevVars(filePath, { overwrite: true });

    assert.equal(process.env.CHAOXING_COOKIE, "UID=from-file");
  });

  test("upsertDevVar creates and updates keys in the vars file", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dev-vars-"));
    const filePath = join(tempDir, ".dev.vars");

    await upsertDevVar("CHAOXING_COOKIE", "UID=1; route=abc", filePath);
    assert.equal(
      await readFile(filePath, "utf8"),
      `CHAOXING_COOKIE="UID=1; route=abc"\n`,
    );

    await upsertDevVar("CHAOXING_COOKIE", "UID=2", filePath);
    await upsertDevVar("RUN_TOKEN", "token", filePath);
    const updated = await readFile(filePath, "utf8");
    assert.match(updated, /^CHAOXING_COOKIE="UID=2"$/m);
    assert.match(updated, /^RUN_TOKEN="token"$/m);
  });
});
