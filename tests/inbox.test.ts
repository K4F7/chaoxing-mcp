import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  extractInboxPageConfig,
  fetchInboxMessages,
  findInboxUrl,
  normalizeNotice,
} from "../src/inbox";

describe("inbox parsing", () => {
  test("finds inbox URL from personal space HTML", () => {
    assert.equal(
      findInboxUrl(
        `onclick="setUrl('637140','https://notice.chaoxing.com/pc/notice/myNotice?s=abc123',this)"`,
        "https://i.chaoxing.com/base",
      ),
      "https://notice.chaoxing.com/pc/notice/myNotice?s=abc123",
    );
  });

  test("extracts inbox page config defaults", () => {
    assert.deepEqual(
      extractInboxPageConfig(`
window.type = '2';
window.folderUUID = '';
window.nowYear = '2026';
window.noticeType= '';
window.fidsCode = '';
`),
      {
        type: "2",
        noticeType: "",
        year: "2026",
        folderUUID: "",
        fidsCode: "",
        queryFolderNoticePrevYear: "0",
      },
    );
  });

  test("normalizes a raw notice", () => {
    assert.deepEqual(
      normalizeNotice({
        idCode: "abc",
        uuid: "$CACG$uuid",
        title: "作业通知",
        createrName: "学习通知",
        sendTime: "2026-05-31 12:00:06",
        isread: 0,
        content: "<p>课程名称：线性代数</p>",
        sendTag: 0,
      }),
      {
        id: "abc",
        uuid: "$CACG$uuid",
        title: "作业通知",
        sender: "学习通知",
        sendTime: "2026-05-31 12:00:06",
        isRead: false,
        content: "课程名称：线性代数",
        detailUrl:
          "https://notice.chaoxing.com/pc/notice/$CACG$uuid/detail?sendTag=0",
        sendTag: 0,
      },
    );
  });

  test("does not follow non-chaoxing redirects with cookies", async () => {
    const calls: Array<{ url: string; cookie: string | null }> = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        cookie: new Headers(init?.headers).get("Cookie"),
      });

      return new Response("", {
        status: 302,
        headers: { Location: "https://evil.example/pc/notice/myNotice" },
      });
    };

    await assert.rejects(
      () =>
        fetchInboxMessages({
          cookie: "UID=secret",
          fetcher: fetcher as unknown as typeof fetch,
        }),
      { message: "untrusted_redirect_target" },
    );

    assert.deepEqual(calls, [
      {
        url: "https://i.chaoxing.com/base?ws=1&t=1780231212848",
        cookie: "UID=secret",
      },
    ]);
  });
});
