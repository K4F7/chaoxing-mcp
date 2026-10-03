export type CookieFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const MAX_COOKIE_REDIRECTS = 10;

export class CookieRequestSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookieRequestSecurityError";
  }
}

export function isTrustedChaoxingUrl(value: string | URL): boolean {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }

  return (
    url.protocol === "https:" &&
    (url.hostname === "chaoxing.com" || url.hostname.endsWith(".chaoxing.com"))
  );
}

export async function fetchChaoxingWithCookie(
  fetcher: CookieFetcher,
  input: string | URL | Request,
  init: RequestInit,
): Promise<Response> {
  const cookie = new Headers(init.headers).get("Cookie");
  if (!cookie?.trim()) {
    throw new CookieRequestSecurityError("missing_cookie_header");
  }

  let currentUrl = extractUrl(input);
  let currentInit = cloneInitForRedirect(init);

  for (let redirectCount = 0; redirectCount <= MAX_COOKIE_REDIRECTS; redirectCount += 1) {
    assertTrustedCookieTarget(currentUrl, "untrusted_cookie_request_target");

    const response = await fetcher(currentUrl, {
      ...currentInit,
      redirect: "manual",
    });

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    if (redirectCount === MAX_COOKIE_REDIRECTS) {
      throw new CookieRequestSecurityError("too_many_cookie_redirects");
    }

    const location = response.headers.get("Location");
    if (!location) {
      throw new CookieRequestSecurityError("redirect_without_location");
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      throw new CookieRequestSecurityError("invalid_redirect_location");
    }
    assertTrustedCookieTarget(nextUrl, "untrusted_redirect_target");
    currentInit = initForRedirect(currentInit, response.status);
    currentUrl = nextUrl;
  }

  throw new CookieRequestSecurityError("too_many_cookie_redirects");
}

function extractUrl(input: string | URL | Request): string {
  if (input instanceof Request) {
    return input.url;
  }

  return input.toString();
}

function assertTrustedCookieTarget(url: string, message: string): void {
  if (!isTrustedChaoxingUrl(url)) {
    throw new CookieRequestSecurityError(message);
  }
}

function cloneInitForRedirect(init: RequestInit): RequestInit {
  return {
    ...init,
    headers: new Headers(init.headers),
  };
}

function initForRedirect(init: RequestInit, status: number): RequestInit {
  const method = (init.method || "GET").toUpperCase();
  const shouldSwitchToGet =
    status === 303 || ((status === 301 || status === 302) && method === "POST");
  if (!shouldSwitchToGet) {
    return cloneInitForRedirect(init);
  }

  const headers = new Headers(init.headers);
  headers.delete("Content-Type");
  headers.delete("Content-Length");

  return {
    ...init,
    method: "GET",
    body: undefined,
    headers,
  };
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
