import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildGoogleCalendarEvent,
  refreshGoogleOAuthAccessToken,
  syncGoogleCalendar,
} from "../src/google-calendar";
import type { SyncItem } from "../src/sync";

describe("google calendar sync", () => {
  test("builds google calendar event payloads with deterministic ids", async () => {
    const event = await buildGoogleCalendarEvent(syncItem());

    assert.match(event.id, /^cx[0-9a-f]{64}$/);
    assert.equal(event.summary, "作业截止：作业通知");
    assert.deepEqual(event.start, {
      dateTime: "2026-06-05T15:59:00.000Z",
      timeZone: "Asia/Shanghai",
    });
    assert.equal(event.extendedProperties.private.chaoxingItemId, "assignment-123");
  });

  test("updates existing events and inserts missing events", async () => {
    const calls: { url: string; method: string }[] = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      calls.push({ url, method });

      if (method === "PUT") {
        return new Response("not found", { status: 404 });
      }

      return Response.json({ id: "created" });
    };

    const result = await syncGoogleCalendar(
      [syncItem()],
      {
        calendarId: "calendar@example.com",
        serviceAccountEmail: "service@example.iam.gserviceaccount.com",
        privateKey: "unused in test",
      },
      {
        fetcher: fetcher as unknown as typeof fetch,
        accessToken: "token",
      },
    );

    assert.deepEqual(result, {
      calendarId: "calendar@example.com",
      attempted: 1,
      created: 1,
      updated: 0,
      skipped: 0,
      failed: [],
    });
    assert.deepEqual(
      calls.map((call) => call.method),
      ["PUT", "POST"],
    );
    assert.equal(
      calls[0]?.url.includes("/calendars/calendar%40example.com/events/"),
      true,
    );
  });

  test("refreshes oauth access tokens", async () => {
    const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(init?.body).includes("grant_type=refresh_token"), true);
      return Response.json({ access_token: "access-token" });
    };

    assert.equal(
      await refreshGoogleOAuthAccessToken(
        {
          calendarId: "primary",
          oauthClientId: "client",
          oauthClientSecret: "secret",
          oauthRefreshToken: "refresh",
        },
        { fetcher: fetcher as unknown as typeof fetch },
      ),
      "access-token",
    );
  });
});

function syncItem(overrides: Partial<SyncItem> = {}): SyncItem {
  return {
    id: "assignment-123",
    kind: "assignment",
    title: "作业通知",
    url: "https://mooc1.chaoxing.com/work?workId=123",
    sourceTitle: "作业通知",
    sourceSendTime: "2026-06-01 08:00:00",
    startAt: "2026-06-01T00:00:00.000Z",
    dueAt: "2026-06-05T15:59:00.000Z",
    status: "answering",
    courseId: "1",
    classId: "2",
    workId: "123",
    answerId: null,
    ...overrides,
  };
}
