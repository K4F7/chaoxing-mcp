import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { handleCalDav } from "../src/caldav";
import type { SyncItem } from "../src/sync";

describe("caldav", () => {
  test("serves collection discovery", async () => {
    const response = await handleCalDav({
      request: new Request("https://example.com/caldav/calendars/me/", {
        method: "PROPFIND",
        headers: { Depth: "1" },
      }),
      itemsLoader: async () => [],
    });
    const body = await response.text();

    assert.equal(response.status, 207);
    assert.equal(body.includes("/caldav/calendars/me/deadlines/"), true);
    assert.equal(body.includes("/caldav/calendars/me/todos/"), true);
  });

  test("reports calendar objects", async () => {
    const response = await handleCalDav({
      request: new Request("https://example.com/caldav/calendars/me/deadlines/", {
        method: "REPORT",
      }),
      itemsLoader: async () => [syncItem()],
    });
    const body = await response.text();

    assert.equal(response.status, 207);
    assert.equal(
      body.includes("/caldav/calendars/me/deadlines/assignment-123.ics"),
      true,
    );
    assert.equal(body.includes("BEGIN:VCALENDAR"), true);
    assert.equal(body.includes("BEGIN:VEVENT"), true);
  });

  test("gets todo objects", async () => {
    const response = await handleCalDav({
      request: new Request(
        "https://example.com/caldav/calendars/me/todos/todo-assignment-123.ics",
      ),
      itemsLoader: async () => [syncItem()],
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type")?.includes("text/calendar"), true);
    assert.equal(body.includes("BEGIN:VTODO"), true);
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
