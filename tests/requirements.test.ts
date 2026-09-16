import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extractQuestions, parseAssignmentRequirement } from "../src/requirements";

describe("assignment requirements", () => {
  test("extracts questions with text and images", () => {
    const questions = extractQuestions(`
<div class="padBom50 questionLi fontLabel singleQuesId" typeName="简答题" id="question1">
  <h3 class="mark_name">1. <span class="colorShallow">(简答题)</span><p>说明要求</p><img src="//example.com/a.jpg"></h3>
  <textarea id="answer1"></textarea>
</div>
`);

    assert.deepEqual(questions, [
      {
        id: "1",
        number: "1",
        type: "简答题",
        text: "说明要求",
        images: ["https://example.com/a.jpg"],
        options: [],
      },
    ]);
  });

  test("parses assignment metadata", () => {
    const parsed = parseAssignmentRequirement({
      html: `
<title>作业作答</title>
<p>作答时间:<em>05-31 12:00</em>至<em>06-05 23:59</em></p>
<input type="hidden" id="workId" value="123" />
<input type="hidden" id="answerId" value="456" />
`,
      entryUrl: "https://example.com/start",
      finalUrl:
        "https://mooc1-api.chaoxing.com/mooc-ans/mooc2/work/dowork?courseId=1&classId=2",
      status: 200,
      sourceTitle: "作业",
      sourceSendTime: "2026-05-31 12:00:06",
      sourceContent: null,
    });

    assert.equal(parsed.workStatus, "answering");
    assert.equal(parsed.workId, "123");
    assert.equal(parsed.answerId, "456");
    assert.deepEqual(parsed.timeWindow, { start: "05-31 12:00", end: "06-05 23:59" });
  });
});
