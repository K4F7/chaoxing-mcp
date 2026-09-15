import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createFetchChaoxingHttp } from "../src/http";

const COOKIE = "UID=1; vc3=abc";
const UNTRUSTED_HTTPS = "https://example.com/steal";

type FetchCall = { url: string; init?: RequestInit };

function recordingFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): {
  calls: FetchCall[];
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
} {
  const calls: FetchCall[] = [];
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    const response = await handler(url, init);
    const redirectMode = init?.redirect ?? "follow";
    if (redirectMode !== "manual" && isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      if (location != null && location.length > 0) {
        return fetchImpl(new URL(location, url).toString(), init);
      }
    }
    return response;
  };
  return { calls, fetchImpl };
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

describe("cookie-bearing Chaoxing HTTP adapter URL 信任分级", () => {
  test("rejects a cookie-bearing request to a non-学习通 https URL without issuing fetch", async () => {
    const { calls, fetchImpl } = recordingFetch(async () => {
      return new Response("should not run", { status: 200 });
    });
    const http = createFetchChaoxingHttp(fetchImpl);

    await assert.rejects(() =>
      http.request({ url: UNTRUSTED_HTTPS, cookie: COOKIE }),
    );
    assert.deepEqual(
      calls.map((call) => call.url),
      [],
    );
  });

  test("does not follow a redirect that leaves 学习通 hosts and does not request the off-trust URL", async () => {
    const trusted = "https://i.chaoxing.com/base";
    const offTrust = "https://evil.example/phish";
    const { calls, fetchImpl } = recordingFetch(async (url) => {
      if (url === trusted) {
        return new Response("", {
          status: 302,
          headers: { Location: offTrust },
        });
      }
      return new Response("should not run", { status: 200 });
    });
    const http = createFetchChaoxingHttp(fetchImpl);

    await assert.rejects(() => http.request({ url: trusted, cookie: COOKIE }));
    assert.deepEqual(
      calls.map((call) => call.url),
      [trusted],
    );
  });

  test("issues fetch for a cookie-bearing request to a 学习通 https URL", async () => {
    const trusted = "https://i.chaoxing.com/base";
    const { calls, fetchImpl } = recordingFetch(async (url) => {
      return new Response(`ok:${url}`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    const http = createFetchChaoxingHttp(fetchImpl);

    const response = await http.request({ url: trusted, cookie: COOKIE });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, `ok:${trusted}`);
    assert.deepEqual(
      calls.map((call) => call.url),
      [trusted],
    );
    assert.equal(calls[0]?.init?.redirect, "manual");
  });

  test("follows a redirect that stays on 学习通 hosts", async () => {
    const start = "https://i.chaoxing.com/base";
    const next = "https://mooc1-api.chaoxing.com/work/task-list";
    const { calls, fetchImpl } = recordingFetch(async (url) => {
      if (url === start) {
        return new Response("", {
          status: 302,
          headers: { Location: next },
        });
      }
      return new Response("course-space", { status: 200 });
    });
    const http = createFetchChaoxingHttp(fetchImpl);

    const response = await http.request({ url: start, cookie: COOKIE });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, "course-space");
    assert.deepEqual(
      calls.map((call) => call.url),
      [start, next],
    );
  });
});

describe("cookie-bearing Chaoxing HTTP adapter POST / form", () => {
  test("rejects an untrusted URL for POST without issuing fetch", async () => {
    const { calls, fetchImpl } = recordingFetch(async () => {
      return new Response("should not run", { status: 200 });
    });
    const http = createFetchChaoxingHttp(fetchImpl);

    await assert.rejects(() =>
      http.request({
        url: UNTRUSTED_HTTPS,
        cookie: COOKIE,
        method: "POST",
        form: { courseType: "1" },
      }),
    );
    assert.deepEqual(
      calls.map((call) => call.url),
      [],
    );
  });

  test("POSTs application/x-www-form-urlencoded body with cookie and extra headers", async () => {
    const trusted =
      "https://mooc1-1.chaoxing.com/mooc-ans/visit/courselistdata";
    const { calls, fetchImpl } = recordingFetch(async () => {
      return new Response("<ul id=\"courseList\"></ul>", { status: 200 });
    });
    const http = createFetchChaoxingHttp(fetchImpl);

    const response = await http.request({
      url: trusted,
      cookie: COOKIE,
      method: "POST",
      form: {
        courseType: "1",
        courseFolderId: "0",
        baseEducation: "0",
        superstarClass: "",
        courseFolderSize: "0",
      },
      headers: {
        Origin: "https://mooc1-1.chaoxing.com",
        Referer: "https://mooc1-1.chaoxing.com/visit/interaction",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, trusted);
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal(calls[0]?.init?.redirect, "manual");
    const headers = new Headers(calls[0]?.init?.headers);
    assert.equal(headers.get("cookie"), COOKIE);
    assert.match(
      headers.get("content-type") ?? "",
      /application\/x-www-form-urlencoded/i,
    );
    assert.equal(headers.get("origin"), "https://mooc1-1.chaoxing.com");
    assert.equal(
      headers.get("referer"),
      "https://mooc1-1.chaoxing.com/visit/interaction",
    );
    assert.equal(headers.get("x-requested-with"), "XMLHttpRequest");
    assert.equal(
      String(calls[0]?.init?.body),
      "courseType=1&courseFolderId=0&baseEducation=0&superstarClass=&courseFolderSize=0",
    );
  });
});
