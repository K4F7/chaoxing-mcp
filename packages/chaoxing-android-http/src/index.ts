import {
  collectSetCookieHeader,
  createCookieAwareHttpClient,
  type ChaoxingHttpClient,
  type ChaoxingHttpRequest,
  type ChaoxingHttpResponse,
  type CookieSessionPort,
  type NativeCookieJar,
} from "@chaoxing-mcp/domain";

export type NativeHttpModule = {
  send(request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    form?: Record<string, string>;
  }): Promise<{
    status: number;
    url: string;
    headers: Record<string, string>;
    body: string;
  }>;
  snapshotCookies?(url: string): Promise<string> | string;
};

export type FetchLike = (
  input: string,
  init: {
    method: string;
    redirect: "manual";
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{
  status: number;
  url?: string;
  headers: {
    get(name: string): string | null;
    getSetCookie?(): string[];
    forEach?(callback: (value: string, key: string) => void): void;
  };
  text(): Promise<string>;
}>;

export function createNativeHttpClient(
  native: NativeHttpModule,
): ChaoxingHttpClient {
  return {
    async send(request: ChaoxingHttpRequest): Promise<ChaoxingHttpResponse> {
      const response = await native.send({
        method: request.method,
        url: request.url,
        headers: request.headers,
        form: request.form,
      });
      return {
        status: response.status,
        url: response.url || request.url,
        headers: response.headers,
        body: response.body,
      };
    },
  };
}

export function createFetchHttpClient(
  fetchImpl: FetchLike,
  userAgent: string,
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
      const collected = collectSetCookieHeader(response.headers);
      const responseHeaders: Record<string, string> = {};
      if (typeof response.headers.forEach === "function") {
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
      }
      for (const name of ["set-cookie", "location", "content-type"]) {
        const value =
          name === "set-cookie" ? collected : response.headers.get(name);
        if (value != null && value.length > 0 && !headerHas(responseHeaders, name)) {
          responseHeaders[name] = value;
        }
      }
      return {
        status: response.status,
        url: response.url && response.url.length > 0 ? response.url : request.url,
        headers: responseHeaders,
        body: await response.text(),
      };
    },
  };
}

export function createCookieManagerJar(
  native: Pick<NativeHttpModule, "snapshotCookies"> | null | undefined,
): NativeCookieJar | undefined {
  if (native?.snapshotCookies == null) {
    return undefined;
  }
  return {
    async snapshot(url: string) {
      const raw = await native.snapshotCookies!(url);
      if (raw == null || raw.trim().length === 0) {
        return null;
      }
      return raw
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.includes("="))
        .map((part) => `${part}; Path=/`)
        .join(", ");
    },
  };
}

export function createProductionHttpClient(options: {
  session: CookieSessionPort;
  fetchImpl: FetchLike;
  userAgent: string;
  native?: NativeHttpModule | null;
}): ChaoxingHttpClient {
  const inner =
    options.native != null
      ? createNativeHttpClient(options.native)
      : createFetchHttpClient(options.fetchImpl, options.userAgent);
  return createCookieAwareHttpClient({
    inner,
    session: options.session,
    nativeJar: createCookieManagerJar(options.native),
  });
}

function headerHas(headers: Record<string, string>, name: string): boolean {
  const expected = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === expected);
}
