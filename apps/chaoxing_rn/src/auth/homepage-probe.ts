import { isTrustedChaoxingUrl } from "@chaoxing-mcp/domain";

import { cookieHeaderForChaoxingUri } from "./cookie-store";
import { CHAOXING_HOME_URL } from "./login-navigation";
import {
  type AuthCheckResult,
  evaluateAuth,
} from "./login-signals";
import type { CookieAuthenticator } from "./session";
import {
  hasChaoxingIdentityCookieSource,
  isSafeChaoxingCookieSource,
} from "./cookie-store";

export const CHAOXING_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

const MAX_TRUSTED_REDIRECTS = 5;

export type FetchLike = (
  input: string,
  init: {
    method: string;
    redirect: "manual";
    headers: Record<string, string>;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  url?: string;
  text(): Promise<string>;
}>;

export function createIdentityAuthenticator(): CookieAuthenticator {
  return async (source) => {
    const ok =
      isSafeChaoxingCookieSource(source) &&
      hasChaoxingIdentityCookieSource(source);
    return {
      authenticated: ok,
      statusCode: ok ? 200 : 0,
      loginDetected: false,
      finalUrl: "",
      title: null,
    };
  };
}

export function createHomepageAuthProbe(fetchImpl: FetchLike): CookieAuthenticator {
  return async (source) => {
    let current = CHAOXING_HOME_URL;
    for (let hop = 0; hop < MAX_TRUSTED_REDIRECTS; hop += 1) {
      if (!isTrustedChaoxingUrl(current)) {
        return unauthenticated(0, current);
      }
      const response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": CHAOXING_USER_AGENT,
          Cookie: cookieHeaderForChaoxingUri(source, current),
        },
      });
      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          return unauthenticated(response.status, current);
        }
        current = new URL(location, current).toString();
        continue;
      }
      const html = await response.text();
      const finalUrl = response.url && response.url.length > 0 ? response.url : current;
      return evaluateAuth({
        statusCode: response.status,
        finalUrl,
        html,
      });
    }
    return unauthenticated(0, current);
  };
}

export function createLoginAuthenticator(
  homepageProbe?: CookieAuthenticator,
): CookieAuthenticator {
  const identity = createIdentityAuthenticator();
  return async (source) => {
    const local = await identity(source);
    if (!local.authenticated) {
      return local;
    }
    if (!homepageProbe) {
      return local;
    }
    return homepageProbe(source);
  };
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function unauthenticated(statusCode: number, finalUrl: string): AuthCheckResult {
  return {
    authenticated: false,
    statusCode,
    loginDetected: false,
    finalUrl,
    title: null,
  };
}
