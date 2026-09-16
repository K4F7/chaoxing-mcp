import type { ChaoxingHttp, ChaoxingHttpRequest } from "./list-todos";

const MAX_COOKIE_REDIRECTS = 10;

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "status" | "url" | "headers" | "text">>;

export function isTrustedChaoxingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "chaoxing.com" || url.hostname.endsWith(".chaoxing.com"))
    );
  } catch {
    return false;
  }
}

export type TrustedFetchResult = {
  statusCode: number;
  url: string;
  body: string;
  cookie: string;
};

export function readSetCookieHeaders(
  headers: Pick<Headers, "get">,
): string[] {
  const withGetSetCookie = headers as Pick<Headers, "get"> & {
    getSetCookie?: () => string[];
  };
  if (typeof withGetSetCookie.getSetCookie === "function") {
    return withGetSetCookie.getSetCookie();
  }
  // Node < 18.14 / undici without getSetCookie collapses multiple Set-Cookie
  // headers; Expires commas make safe splitting unreliable. Require getSetCookie.
  const combined = headers.get("set-cookie");
  if (combined == null || combined.trim() === "") {
    return [];
  }
  // Single cookie responses still work; multi-cookie needs getSetCookie.
  if (!combined.includes(",")) {
    return [combined];
  }
  // Heuristic: split on ", <cookie-name>=" patterns typical of collapsed headers.
  const parts = combined.split(/,(?=\s*[^;=,]+=)/);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

export async function fetchTrustedChaoxing(
  fetchImpl: FetchLike,
  input: ChaoxingHttpRequest,
  options: {
    mergeSetCookie?: (cookie: string, setCookies: string[]) => string;
  } = {},
): Promise<TrustedFetchResult> {
  let currentUrl = input.url;
  let cookie = input.cookie;
  for (let hop = 0; hop <= MAX_COOKIE_REDIRECTS; hop += 1) {
    if (!isTrustedChaoxingUrl(currentUrl)) {
      throw new Error(
        hop === 0
          ? "untrusted_cookie_request_target"
          : "untrusted_redirect_target",
      );
    }
    const hopInput: ChaoxingHttpRequest = {
      ...input,
      url: currentUrl,
      cookie,
    };
    const response = await fetchImpl(
      currentUrl,
      buildFetchInit(hopInput, hop === 0 ? currentUrl : null),
    );
    if (options.mergeSetCookie != null) {
      cookie = options.mergeSetCookie(
        cookie,
        readSetCookieHeaders(response.headers),
      );
    }
    if (!isRedirectStatus(response.status)) {
      return {
        statusCode: response.status,
        url:
          response.url && response.url.length > 0 ? response.url : currentUrl,
        body: await response.text(),
        cookie,
      };
    }
    if (hop === MAX_COOKIE_REDIRECTS) {
      throw new Error("too_many_cookie_redirects");
    }
    const location = response.headers.get("location");
    if (location == null || location.trim() === "") {
      throw new Error("redirect_without_location");
    }
    currentUrl = resolveChaoxingRedirect(currentUrl, location);
  }
  throw new Error("too_many_cookie_redirects");
}

export function createFetchChaoxingHttp(
  fetchImpl: FetchLike = globalThis.fetch,
): ChaoxingHttp {
  return {
    async request(input) {
      const result = await fetchTrustedChaoxing(fetchImpl, input);
      return {
        statusCode: result.statusCode,
        url: result.url,
        body: result.body,
      };
    },
  };
}

function resolveChaoxingRedirect(
  currentUrl: string,
  location: string,
): string {
  try {
    const parsed = new URL(location, currentUrl);
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "chaoxing.com" ||
        parsed.hostname.endsWith(".chaoxing.com"))
    ) {
      parsed.protocol = "https:";
    }
    return parsed.toString();
  } catch {
    throw new Error("invalid_redirect_location");
  }
}

function buildFetchInit(
  input: ChaoxingHttpRequest,
  originalUrl: string | null,
): RequestInit {
  const method = (input.method ?? "GET").toUpperCase();
  const headers = new Headers(input.headers);
  headers.set("cookie", input.cookie);

  // Only the first hop carries the form body (POST). Redirect follow-ups are GET-like
  // unless the status is 307/308; we keep body only when still on the original URL.
  const sendBody =
    originalUrl != null &&
    method === "POST" &&
    input.form !== undefined;

  if (sendBody) {
    if (!headers.has("content-type")) {
      headers.set(
        "content-type",
        "application/x-www-form-urlencoded; charset=UTF-8",
      );
    }
    return {
      method: "POST",
      headers,
      body: encodeForm(input.form ?? {}),
      redirect: "manual",
    };
  }

  return {
    method: originalUrl == null ? "GET" : method,
    headers,
    redirect: "manual",
  };
}

function encodeForm(form: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    params.append(key, value);
  }
  return params.toString();
}

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}
