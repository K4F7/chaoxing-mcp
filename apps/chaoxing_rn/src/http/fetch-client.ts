import {
  collectSetCookieHeader,
  createCookieAwareHttpClient,
  type ChaoxingHttpClient,
  type ChaoxingHttpRequest,
  type ChaoxingHttpResponse,
  type CookieSessionPort,
} from "@chaoxing-mcp/domain";
import {
  createProductionHttpClient,
  type FetchLike as NativeFetchLike,
  type NativeHttpModule,
} from "@chaoxing-mcp/android-http";

import { CHAOXING_USER_AGENT } from "../auth/homepage-probe";

export type FetchLike = NativeFetchLike;

/**
 * Injected HTTP client for {@link createLocalSyncRunner}.
 * Redirects stay manual so the runner can refuse untrusted hops
 * and keep Cookie off hosts outside the 学习通 whitelist.
 */
export function createFetchChaoxingClient(
  fetchImpl: FetchLike,
  userAgent: string = CHAOXING_USER_AGENT,
): ChaoxingHttpClient {
  return {
    async send(request: ChaoxingHttpRequest): Promise<ChaoxingHttpResponse> {
      const headers: Record<string, string> = {
        Accept: "text/html,application/xhtml+xml,application/json",
        "User-Agent": userAgent,
        ...request.headers,
      };
      let body: string | undefined;
      if (request.method === "POST" && request.form) {
        body = new URLSearchParams(request.form).toString();
        if (!headerHas(headers, "content-type")) {
          headers["Content-Type"] = "application/x-www-form-urlencoded";
        }
      }
      const response = await fetchImpl(request.url, {
        method: request.method,
        redirect: "manual",
        headers,
        ...(body !== undefined ? { body } : {}),
      });
      return {
        status: response.status,
        url: response.url && response.url.length > 0 ? response.url : request.url,
        headers: collectHeaders(response.headers),
        body: await response.text(),
      };
    },
  };
}

export function createSessionHttpClient(options: {
  session: CookieSessionPort;
  fetchImpl: FetchLike;
  native?: NativeHttpModule | null;
  userAgent?: string;
}): ChaoxingHttpClient {
  return createProductionHttpClient({
    session: options.session,
    fetchImpl: options.fetchImpl,
    userAgent: options.userAgent ?? CHAOXING_USER_AGENT,
    native: options.native,
  });
}

export function wrapCookieAwareClient(
  inner: ChaoxingHttpClient,
  session: CookieSessionPort,
): ChaoxingHttpClient {
  return createCookieAwareHttpClient({ inner, session });
}

function headerHas(headers: Record<string, string>, name: string): boolean {
  const expected = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === expected);
}

function collectHeaders(headers: {
  get(name: string): string | null;
  getSetCookie?(): string[];
  forEach?(callback: (value: string, key: string) => void): void;
}): Record<string, string> {
  const collected: Record<string, string> = {};
  if (typeof headers.forEach === "function") {
    headers.forEach((value, key) => {
      collected[key] = value;
    });
  }
  const setCookie = collectSetCookieHeader(headers);
  for (const name of ["set-cookie", "location", "content-type"]) {
    const value = name === "set-cookie" ? setCookie : headers.get(name);
    if (value != null && value.length > 0 && !headerHas(collected, name)) {
      collected[name] = value;
    }
  }
  return collected;
}
