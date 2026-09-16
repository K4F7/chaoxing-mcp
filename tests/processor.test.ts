import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  collectUniqueWorkLinks,
  fetchDetailSummary,
  isAssignmentOrExamRelated,
  processAssignments,
  type DetailSummary,
} from "../src/processor";

describe("assignment processor", () => {
  test("detects assignment related inbox messages", () => {
    assert.equal(
      isAssignmentOrExamRelated({
        id: "1",
        uuid: null,
        title: "作业截止提醒",
        sender: null,
        sendTime: null,
        isRead: false,
        content: null,
        detailUrl: null,
        sendTag: 0,
      }),
      true,
    );
  });

  test("extracts unique work links from detail summaries", () => {
    const summary = {
      title: "作业",
      sendTime: null,
      detailStatus: 200,
      apiStatus: true,
      detailTitle: "作业",
      sourceType: null,
      content: null,
      assignmentLinks: [
        "https://mooc1.chaoxing.com/work?workOrExam=work&workId=1",
        "https://mooc1.chaoxing.com/work?workOrExam=work&workId=1",
        "https://mooc1.chaoxing.com/exam?workOrExam=exam&examId=2",
      ],
      decodedAttachments: [],
    } satisfies DetailSummary;

    assert.deepEqual([...collectUniqueWorkLinks([summary]).keys()], [
      "https://mooc1.chaoxing.com/work?workOrExam=work&workId=1",
      "https://mooc1.chaoxing.com/exam?workOrExam=exam&examId=2",
    ]);
  });

  test("rejects non-chaoxing work links before cookie-bearing fetch", () => {
    const summary = {
      title: "作业",
      sendTime: null,
      detailStatus: 200,
      apiStatus: true,
      detailTitle: "作业",
      sourceType: null,
      content: null,
      assignmentLinks: [
        "https://evil.example/work?workOrExam=work",
        "https://mooc1.chaoxing.com/work?workOrExam=work&workId=1",
      ],
      decodedAttachments: [],
    } satisfies DetailSummary;

    assert.deepEqual([...collectUniqueWorkLinks([summary]).keys()], [
      "https://mooc1.chaoxing.com/work?workOrExam=work&workId=1",
    ]);
  });

  test("fetches detail summary with decoded attachment links", async () => {
    const attachment = encodeURIComponent(
      btoa(
        JSON.stringify({
          url: "https://mooc1.chaoxing.com/work?workOrExam=work&workId=1",
        }),
      ),
    );
    const fetcher = async () =>
      Response.json({
        status: true,
        msg: {
          title: "作业",
          rtf_content: `<iframe name="${attachment}"></iframe>`,
        },
      });

    const summary = await fetchDetailSummary({
      cookie: "UID=1",
      fetcher: fetcher as unknown as typeof fetch,
      message: {
        id: "notice-1",
        uuid: null,
        title: "作业",
        sender: null,
        sendTime: "2026-06-01 08:00:00",
        isRead: false,
        content: null,
        detailUrl: null,
        sendTag: 0,
      },
    });

    assert.deepEqual(summary.assignmentLinks, [
      "https://mooc1.chaoxing.com/work?workOrExam=work&workId=1",
    ]);
  });

  test("processes inbox details and assignment requirements", async () => {
    const calls: string[] = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);

      if (url.startsWith("https://i.chaoxing.com/base")) {
        return new Response(
          `https://notice.chaoxing.com/pc/notice/myNotice?s=abc123`,
          { headers: { "Content-Type": "text/html" } },
        );
      }

      if (url.startsWith("https://notice.chaoxing.com/pc/notice/myNotice")) {
        return new Response("window.nowYear='2026';", {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (url.endsWith("/pc/notice/getNoticeList")) {
        return Response.json({
          status: true,
          notices: {
            list: [
              {
                id: "notice-1",
                title: "作业通知",
                sendTime: "2026-06-01 08:00:00",
                isread: 0,
                content: "请完成作业",
                sendTag: 0,
              },
            ],
            lastPage: true,
          },
        });
      }

      if (url.includes("/getNoticeDetail")) {
        return Response.json({
          status: true,
          msg: {
            title: "作业通知",
            rtf_content:
              "https://mooc1.chaoxing.com/work?workOrExam=work&workId=1",
          },
        });
      }

      if (url.startsWith("https://mooc1.chaoxing.com/work")) {
        return new Response(
          `<title>作业作答</title><input id="workId" value="1" />`,
          { status: 200 },
        );
      }

      return new Response("not found", { status: 404 });
    };

    const result = await processAssignments({
      cookie: "UID=1",
      fetcher: fetcher as unknown as typeof fetch,
      inboxLimit: 5,
      detailsLimit: 5,
      requirementsLimit: 5,
    });

    assert.deepEqual(result.inbox, {
      fetched: 1,
      relevant: 1,
      inspectedDetails: 1,
    });
    assert.equal(result.totalUniqueActivityLinks, 1);
    assert.equal(result.totalUniqueWorkLinks, 1);
    assert.equal(result.fetchedRequirements, 1);
    assert.deepEqual(result.failedRequirements, []);
    assert.equal(result.requirements[0]?.workId, "1");
    assert.equal(calls.includes("https://notice.chaoxing.com/pc/notice/getNoticeList"), true);
  });

  test("does not send cookies to malicious assignment links from notices", async () => {
    const calls: Array<{ url: string; cookie: string | null }> = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        cookie: new Headers(init?.headers).get("Cookie"),
      });

      if (url.startsWith("https://i.chaoxing.com/base")) {
        return new Response(
          `https://notice.chaoxing.com/pc/notice/myNotice?s=abc123`,
          { headers: { "Content-Type": "text/html" } },
        );
      }

      if (url.startsWith("https://notice.chaoxing.com/pc/notice/myNotice")) {
        return new Response("window.nowYear='2026';", {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (url.endsWith("/pc/notice/getNoticeList")) {
        return Response.json({
          status: true,
          notices: {
            list: [
              {
                id: "notice-1",
                title: "作业通知",
                sendTime: "2026-06-01 08:00:00",
                isread: 0,
                content: "请完成作业",
                sendTag: 0,
              },
            ],
            lastPage: true,
          },
        });
      }

      if (url.includes("/getNoticeDetail")) {
        return Response.json({
          status: true,
          msg: {
            title: "作业通知",
            rtf_content: "https://evil.example/work?workOrExam=work",
          },
        });
      }

      if (url.startsWith("https://evil.example")) {
        return new Response("leaked", { status: 200 });
      }

      return new Response("not found", { status: 404 });
    };

    const result = await processAssignments({
      cookie: "UID=secret",
      fetcher: fetcher as unknown as typeof fetch,
      inboxLimit: 5,
      detailsLimit: 5,
      requirementsLimit: 5,
    });

    assert.equal(result.totalUniqueWorkLinks, 0);
    assert.equal(result.fetchedRequirements, 0);
    assert.equal(calls.some((call) => call.url.startsWith("https://evil.example")), false);
    assert.equal(
      calls.some(
        (call) =>
          call.url.startsWith("https://evil.example") &&
          call.cookie === "UID=secret",
      ),
      false,
    );
  });
});
