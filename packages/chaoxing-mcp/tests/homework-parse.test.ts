import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  HOMEWORK_TYPE_LABELS,
  buildDraftSaveForm,
  parseAnswerSheet,
  parseHomeworkQuestionPage,
  parseSubmitTestFields,
} from "../src/homework-parse";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/homework",
);

function load(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

describe("HOMEWORK_TYPE_LABELS", () => {
  test("covers choice, blank, proof, calc, nested blank", () => {
    assert.equal(HOMEWORK_TYPE_LABELS[0], "单选题");
    assert.equal(HOMEWORK_TYPE_LABELS[1], "多选题");
    assert.equal(HOMEWORK_TYPE_LABELS[2], "填空题");
    assert.equal(HOMEWORK_TYPE_LABELS[4], "简答题");
    assert.equal(HOMEWORK_TYPE_LABELS[7], "计算题");
    assert.equal(HOMEWORK_TYPE_LABELS[15], "填空题");
  });
});

describe("parseHomeworkQuestionPage", () => {
  test("parses q3-blank type 2 with one blank slot and stem image", () => {
    const parsed = parseHomeworkQuestionPage(load("q3-blank.html"));

    assert.equal(parsed.question_id, "405823585");
    assert.equal(parsed.index, 3);
    assert.equal(parsed.type, 2);
    assert.equal(parsed.type_label, "填空题");
    assert.equal(parsed.supports_save, true);
    assert.equal(parsed.blanks.length, 1);
    assert.equal(parsed.blanks[0]?.slot, "1");
    assert.equal(parsed.blanks[0]?.name, "answer4058235851");
    assert.match(
      parsed.stem_image_urls[0] ?? "",
      /p\.ananas\.chaoxing\.com\/star3\/origin\/f3a8049f7d50684fa0b5ef326b5f559a\.png/,
    );
    assert.equal(parsed.title.includes("填空"), true);
  });

  test("parses q0-calc type 7 as unsavable with stem images", () => {
    const parsed = parseHomeworkQuestionPage(load("q0-calc.html"));

    assert.equal(parsed.question_id, "405804315");
    assert.equal(parsed.index, 0);
    assert.equal(parsed.type, 7);
    assert.equal(parsed.type_label, "计算题");
    assert.equal(parsed.supports_save, false);
    assert.equal(parsed.blanks.length, 0);
    assert.match(
      parsed.stem_image_urls[0] ?? "",
      /p\.ananas\.chaoxing\.com\/star3\/origin\/9dbdff2782e7c6f20c56082f975d8d07\.png/,
    );
  });

  test("parses q4-blank15 nested blanks", () => {
    const parsed = parseHomeworkQuestionPage(load("q4-blank15.html"));

    assert.equal(parsed.question_id, "405823589");
    assert.equal(parsed.index, 4);
    assert.equal(parsed.type, 15);
    assert.equal(parsed.supports_save, true);
    assert.ok(parsed.blanks.length >= 2);
    assert.ok(
      parsed.blanks.every((blank) => blank.name.startsWith("my-content")),
    );
    assert.ok(parsed.stem_image_urls.length >= 1);
  });

  test("parses radio and checkbox choice options when present", () => {
    const html = `
      <h2 class="titType">1. 单选题</h2>
      <div class="workWrap"><p>Pick one</p></div>
      <input type="hidden" name="type99" value="0"/>
      <input type="hidden" name="questionId" id="questionId" value="99"/>
      <input type="hidden" name="index" id="index" value="0"/>
      <input type="radio" name="answer99" value="A"/>
      <input type="radio" name="answer99" value="B" checked/>
      <input type="checkbox" name="answers100" value="A" checked/>
      <input type="checkbox" name="answers100" value="C"/>
      <form id="submitTest"></form>
    `;
    const parsed = parseHomeworkQuestionPage(html);
    assert.equal(parsed.type, 0);
    assert.equal(parsed.supports_save, true);
    assert.deepEqual(
      parsed.choice_options.map((o) => o.value),
      ["A", "B"],
    );
    assert.equal(parsed.current_answer, "B");
  });
});

describe("parseAnswerSheet", () => {
  test("lists ten questions with type labels from answer-sheet", () => {
    const sheet = parseAnswerSheet(load("answer-sheet.html"));
    assert.equal(sheet.length, 10);
    assert.equal(sheet[0]?.index, 0);
    assert.equal(sheet[0]?.type_label.includes("计算"), true);
    assert.equal(sheet[3]?.type_label.includes("填空"), true);
    assert.equal(sheet[9]?.index, 9);
  });
});

describe("buildDraftSaveForm", () => {
  test("always sets tempSave=true and never false", () => {
    const page = load("q3-blank.html");
    const fields = buildDraftSaveForm(page, {
      blanks: ["hello"],
    });
    assert.equal(fields.tempSave, "true");
    assert.notEqual(fields.tempSave, "false");
    assert.equal(fields.answer4058235851, "hello");
    assert.equal(fields.questionId, "405823585");
  });

  test("forces tempSave=true even when page hidden is false", () => {
    const html = `
      <form id="submitTest">
        <input type="hidden" name="tempSave" value="false"/>
        <input type="hidden" name="questionId" value="1"/>
        <input type="hidden" name="courseId" value="2"/>
      </form>
      <input type="hidden" name="questionId" id="questionId" value="1"/>
      <input type="hidden" name="type1" value="2"/>
      <input type="hidden" id="blankNum1" name="blankNum1" value="1,"/>
      <textarea name="answer11" id="answer11"></textarea>
    `;
    const fields = buildDraftSaveForm(html, { blanks: ["x"] });
    assert.equal(fields.tempSave, "true");
  });

  test("applies single choice and multi choices", () => {
    const html = `
      <form id="submitTest">
        <input type="hidden" name="tempSave" value="true"/>
        <input type="hidden" name="questionId" value="10"/>
        <input type="radio" name="answer10" value="A"/>
        <input type="checkbox" name="answers10" value="A"/>
        <input type="checkbox" name="answers10" value="B"/>
      </form>
      <input type="hidden" name="questionId" id="questionId" value="10"/>
      <input type="hidden" name="type10" value="1"/>
    `;
    const single = buildDraftSaveForm(html, { choice: "A" });
    assert.equal(single.answer10, "A");
    assert.equal(single.tempSave, "true");

    const multi = buildDraftSaveForm(html, { choices: ["A", "B"] });
    assert.equal(multi.answers10, "A,B");
    assert.equal(multi.tempSave, "true");
  });
});

describe("parseSubmitTestFields", () => {
  test("does not invent tempSave=false", () => {
    const fields = parseSubmitTestFields(load("q3-blank.html"));
    assert.equal(fields.tempSave === "false", false);
  });
});
