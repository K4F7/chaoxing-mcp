import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  extractDoHomeworkUrls,
  parseHomeworkPrompt,
} from "../src/parse";

const STEM = "围绕一个自己熟悉的软件，完成一页分析。";

function doHomeWorkHtml(options: {
  titType?: string;
  stemHtml?: string;
} = {}): string {
  const titType = options.titType ?? "1. 简答题";
  const stemHtml =
    options.stemHtml ??
    `<span aria-label="题干"></span>
     <p>${STEM}</p>`;
  return `
    <h2 class="titType">${titType}</h2>
    <div class="ans-cc timuStyle fontLabel workWrap">${stemHtml}</div>
  `;
}

describe("extractDoHomeworkUrls", () => {
  test("reads the doHomeWork path out of jump()", () => {
    const html = `
      <script>
        function jump() {
          window.location.href = "/mooc-ans/work/phone/doHomeWork?courseId=102&workId=55507098&cpi=1&workAnswerId=9&classId=202&enc=abc123";
        }
      </script>`;

    assert.deepEqual(extractDoHomeworkUrls(html), [
      "/mooc-ans/work/phone/doHomeWork?courseId=102&workId=55507098&cpi=1&workAnswerId=9&classId=202&enc=abc123",
    ]);
  });

  test("decodes entities and unescapes script slashes", () => {
    const html = `
      <script>
        function jump() {
          location.href = "https:\\/\\/mooc1-api.chaoxing.com\\/mooc-ans\\/work\\/phone\\/doHomeWork?courseId=102&amp;workId=55507098";
        }
      </script>`;

    assert.deepEqual(extractDoHomeworkUrls(html), [
      "https://mooc1-api.chaoxing.com/mooc-ans/work/phone/doHomeWork?courseId=102&workId=55507098",
    ]);
  });

  test("returns empty when the page has no doHomeWork link", () => {
    const html = `<h4>截止时间：09-22 23:25</h4><p>共包含1道题目，其中简答题1道</p>`;

    assert.deepEqual(extractDoHomeworkUrls(html), []);
  });
});

describe("parseHomeworkPrompt", () => {
  test("strips HTML and takes 题干 text plus kind from titType", () => {
    const parsed = parseHomeworkPrompt(doHomeWorkHtml());

    assert.equal(parsed.summary, STEM);
    assert.equal(parsed.kind, "简答题");
  });

  test("decodes entities and collapses space in the 题干", () => {
    const parsed = parseHomeworkPrompt(
      doHomeWorkHtml({
        stemHtml: `<span aria-label="题干"></span>
          <p>围绕一个&nbsp;自己熟悉的软件，&lt;完成&gt;一页分析。</p>
          <p>要求：不少于800字。</p>`,
      }),
    );

    assert.equal(
      parsed.summary,
      "围绕一个 自己熟悉的软件，<完成>一页分析。 要求：不少于800字。",
    );
    assert.equal(parsed.kind, "简答题");
  });

  test("truncates the 题干 to 1500 characters", () => {
    const stem = "题".repeat(1600);
    const parsed = parseHomeworkPrompt(
      doHomeWorkHtml({ stemHtml: `<p>${stem}</p>` }),
    );

    assert.equal(parsed.summary?.length, 1500);
    assert.equal(parsed.summary, "题".repeat(1500));
  });

  test("returns null summary and kind when the page has no 题干", () => {
    const parsed = parseHomeworkPrompt("<p>无权限</p>");

    assert.equal(parsed.summary, null);
    assert.equal(parsed.kind, null);
  });
});
