import type { ChaoxingHttp } from "./list-todos";

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

export function createFetchChaoxingHttp(
  fetchImpl: FetchLike = globalThis.fetch,
): ChaoxingHttp {
  return {
    async request({ url, cookie }) {
      let currentUrl = url;
      for (let hop = 0; hop <= MAX_COOKIE_REDIRECTS; hop += 1) {
        if (!isTrustedChaoxingUrl(currentUrl)) {
          throw new Error(
            hop === 0
              ? "untrusted_cookie_request_target"
              : "untrusted_redirect_target",
          );
        }
        const response = await fetchImpl(currentUrl, {
          headers: { cookie },
          redirect: "manual",
        });
        if (!isRedirectStatus(response.status)) {
          return {
            statusCode: response.status,
            url:
              response.url && response.url.length > 0
                ? response.url
                : currentUrl,
            body: await response.text(),
          };
        }
        if (hop === MAX_COOKIE_REDIRECTS) {
          throw new Error("too_many_cookie_redirects");
        }
        const location = response.headers.get("location");
        if (location == null || location.trim() === "") {
          throw new Error("redirect_without_location");
        }
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          throw new Error("invalid_redirect_location");
        }
        currentUrl = nextUrl;
      }
      throw new Error("too_many_cookie_redirects");
    },
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
