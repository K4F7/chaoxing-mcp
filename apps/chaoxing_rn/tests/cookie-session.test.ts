import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CookieVault } from "../src/auth/cookie-vault";
import { MemorySecureStore } from "../src/auth/secure-store";
import { SessionController } from "../src/auth/session-controller";
import { wrapCookieAwareClient } from "../src/http/fetch-client";
import type { ChaoxingHttpClient } from "@chaoxing-mcp/domain";

describe("session cookie rotation", () => {
  test("replaceCookieSource writes the vault without re-auth", async () => {
    const vault = new CookieVault(new MemorySecureStore());
    const session = new SessionController({ vault });
    await session.importCookieSource("UID=1; vc3=old");
    await session.replaceCookieSource("UID=1; vc3=rotated");
    assert.match(session.getCookieSource(), /vc3=rotated/);
    const stored = await vault.load();
    assert.match(stored.cookieSource, /vc3=rotated/);
  });

  test("cookie-aware wrapper persists Set-Cookie into the session", async () => {
    const session = new SessionController({
      vault: new CookieVault(new MemorySecureStore()),
    });
    await session.importCookieSource("UID=1; vc3=old");
    const inner: ChaoxingHttpClient = {
      async send(request) {
        return {
          status: 200,
          url: request.url,
          headers: {
            "set-cookie": "vc3=fresh; Domain=chaoxing.com; Path=/; Secure",
          },
          body: "ok",
        };
      },
    };
    await wrapCookieAwareClient(inner, {
      getSource: () => session.getCookieSource(),
      persist: (source) => session.replaceCookieSource(source),
    }).send({
      method: "GET",
      url: "https://i.chaoxing.com/",
      headers: {},
    });
    assert.match(session.getCookieSource(), /fresh/);
  });

  test("rejects newline cookie sources and does not persist them", async () => {
    const session = new SessionController({
      vault: new CookieVault(new MemorySecureStore()),
    });
    await session.importCookieSource("UID=1; vc3=old");
    await session.replaceCookieSource("UID=1; vc3=x\nSet-Cookie: evil=1");
    assert.match(session.getCookieSource(), /vc3=old/);
  });
});
