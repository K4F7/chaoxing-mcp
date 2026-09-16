import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildAppSyncResponse } from "../src/app-sync";
import type { ProcessingResult } from "../src/processor";
import type { SyncItem } from "../src/sync";

describe("app sync response", () => {
  test("maps processing results to a compact app response", () => {
    const response = buildAppSyncResponse(
      processingResult({
        failedRequirements: [
          {
            entryUrl: "https://example.com/fail",
            sourceTitle: "失败通知",
            message: "assignment_fetch_failed_500",
          },
        ],
      }),
      [
        syncItem({
          id: "assignment-later",
          title: "后截止",
          dueAt: "2026-06-06T10:00:00.000Z",
        }),
        syncItem({
          id: "exam-soon",
          kind: "exam",
          title: "先截止",
          dueAt: "2026-06-05T10:00:00.000Z",
        }),
      ],
      { now: new Date("2026-06-05T09:00:00.000Z") },
    );

    assert.equal(response.lastSyncedAt, "2026-06-05T08:00:00.000Z");
    assert.equal(response.authStatus, "ok");
    assert.equal(response.items.length, 2);
    assert.equal(response.items[0]?.id, "exam-soon");
    assert.equal(response.items[0]?.kind, "exam");
    assert.equal(response.items[0]?.displayStatus, "today");
    assert.equal(response.items[0]?.dueInHours, 1);
    assert.equal(response.items[1]?.id, "assignment-later");
    assert.equal(response.items[1]?.displayStatus, "upcoming");
    assert.equal(response.items[1]?.dueInHours, 25);
    assert.deepEqual(response.failures, [
      {
        entryUrl: "https://example.com/fail",
        sourceTitle: "失败通知",
        message: "assignment_fetch_failed_500",
      },
    ]);
    assert.deepEqual(response.meta, {
      inbox: {
        fetched: 3,
        relevant: 2,
        inspectedDetails: 2,
      },
      fetchedRequirements: 2,
      totalUniqueActivityLinks: 2,
      totalUniqueWorkLinks: 2,
    });
  });

  test("marks overdue items for app grouping", () => {
    const response = buildAppSyncResponse(
      processingResult(),
      [
        syncItem({
          id: "assignment-overdue",
          dueAt: "2026-06-05T08:00:00.000Z",
        }),
      ],
      { now: new Date("2026-06-05T09:00:00.000Z") },
    );

    assert.equal(response.items[0]?.displayStatus, "overdue");
    assert.equal(response.items[0]?.dueInHours, -1);
  });
});

function processingResult(
  overrides: Partial<ProcessingResult> = {},
): ProcessingResult {
  return {
    processedAt: "2026-06-05T08:00:00.000Z",
    inbox: {
      fetched: 3,
      relevant: 2,
      inspectedDetails: 2,
    },
    totalUniqueActivityLinks: 2,
    totalUniqueWorkLinks: 2,
    fetchedRequirements: 2,
    failedRequirements: [],
    requirements: [],
    ...overrides,
  };
}

function syncItem(overrides: Partial<SyncItem> = {}): SyncItem {
  return {
    id: "assignment-1",
    kind: "assignment",
    title: "作业",
    url: "https://mooc1.chaoxing.com/work?workId=1",
    sourceTitle: "作业通知",
    sourceSendTime: "2026-06-01 08:00:00",
    startAt: null,
    dueAt: "2026-06-05T10:00:00.000Z",
    status: "answering",
    courseId: null,
    classId: null,
    workId: "1",
    answerId: null,
    ...overrides,
  };
}
