import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  dueAtFromRemaining,
  parseCourseSpaceTodos,
  parseWorkDetailDueAt,
  type EnrolledCourse,
} from "../src/parse";

const COURSE: EnrolledCourse = {
  courseId: "102",
  classId: "202",
  cpi: "1",
  title: "261-软件工程",
};

describe("dueAtFromRemaining", () => {
  test("converts 剩余172小时1分钟 to ISO +08:00 from injected now", () => {
    const now = new Date("2026-09-14T09:23:32.000Z");

    const dueAt = dueAtFromRemaining("剩余172小时1分钟", now);

    assert.equal(dueAt, "2026-09-21T21:24:32+08:00");
  });

  test("converts 剩余3天 to ISO +08:00 from injected now", () => {
    const now = new Date("2026-09-14T09:23:32.000Z");

    const dueAt = dueAtFromRemaining("剩余3天", now);

    assert.equal(dueAt, "2026-09-17T17:23:32+08:00");
  });

  test("converts 剩余15分钟 to ISO +08:00 from injected now", () => {
    const now = new Date("2026-09-14T09:23:32.000Z");

    const dueAt = dueAtFromRemaining("剩余15分钟", now);

    assert.equal(dueAt, "2026-09-14T17:38:32+08:00");
  });

  test("converts 剩余2小时 without minutes", () => {
    const now = new Date("2026-09-14T09:23:32.000Z");

    const dueAt = dueAtFromRemaining("剩余2小时", now);

    assert.equal(dueAt, "2026-09-14T19:23:32+08:00");
  });
});

describe("parseWorkDetailDueAt", () => {
  test("parses 截止时间：MM-DD HH:mm with year not earlier than now", () => {
    const now = new Date("2026-09-14T09:23:32.000Z");
    const html = "<h4>截止时间：09-22 23:25</h4>";

    const dueAt = parseWorkDetailDueAt(html, now);

    assert.equal(dueAt, "2026-09-22T23:25:00+08:00");
  });

  test("parses aria-label 截止时间M月D日H时M分S秒 with year not earlier than now", () => {
    const now = new Date("2026-09-14T09:23:32.000Z");
    const html =
      '<span aria-label="截止时间09月22日23时25分34秒"></span>';

    const dueAt = parseWorkDetailDueAt(html, now);

    assert.equal(dueAt, "2026-09-22T23:25:34+08:00");
  });

  test("rolls MM-DD to next year when that date would be earlier than now", () => {
    const now = new Date("2026-12-20T01:00:00.000Z");
    const html = "<h4>截止时间：01-05 08:00</h4>";

    const dueAt = parseWorkDetailDueAt(html, now);

    assert.equal(dueAt, "2027-01-05T08:00:00+08:00");
  });

  test("parses 截止时间：YYYY-MM-DD HH:mm on the detail page", () => {
    const now = new Date("2026-09-14T09:23:32.000Z");
    const html = "<span>截止时间：2026-09-20 23:59</span>";

    const dueAt = parseWorkDetailDueAt(html, now);

    assert.equal(dueAt, "2026-09-20T23:59:00+08:00");
  });
});

describe("parseCourseSpaceTodos due_at", () => {
  test("still parses 截止时间：YYYY-MM-DD HH:mm on the list", () => {
    const html = `
      <ul>
        <li data="/mooc-ans/work/phone/task-work?taskrefId=2611&amp;courseId=102&amp;classId=202">
          <p>新课作业</p>
          <span class="status">未提交</span>
          <span>截止时间：2026-09-20 23:59</span>
        </li>
      </ul>`;

    const todos = parseCourseSpaceTodos(html, COURSE);

    assert.equal(todos.length, 1);
    assert.equal(todos[0]?.id, "2611");
    assert.equal(todos[0]?.due_at, "2026-09-20T23:59:00+08:00");
    assert.equal(todos[0]?.closed, false);
  });

  test("list with only 剩余 time has no absolute due_at and keeps remaining text plus entry url", () => {
    const html = `
      <li data="/mooc-ans/work/phone/task-work?taskrefId=55507098&amp;courseId=102&amp;classId=202" data1="55507098">
        <p>新建作业20260914172332</p>
        <span>未交</span>
        <span class="fr">剩余172小时1分钟</span>
      </li>`;

    const todos = parseCourseSpaceTodos(html, COURSE);

    assert.equal(todos.length, 1);
    assert.equal(todos[0]?.id, "55507098");
    assert.equal(todos[0]?.title, "新建作业20260914172332");
    assert.equal(todos[0]?.due_at, null);
    assert.equal(todos[0]?.closed, false);
    assert.equal(todos[0]?.remaining_text, "剩余172小时1分钟");
    assert.equal(
      todos[0]?.entry_url,
      "/mooc-ans/work/phone/task-work?taskrefId=55507098&courseId=102&classId=202",
    );
  });

  test("parses list 截止时间：MM-DD HH:mm with year not earlier than now", () => {
    const now = new Date("2026-09-14T09:23:32.000Z");
    const html = `
      <li data="/mooc-ans/work/phone/task-work?taskrefId=2611">
        <p>新课作业</p>
        <span>截止时间：09-22 23:25</span>
      </li>`;

    const todos = parseCourseSpaceTodos(html, COURSE, now);

    assert.equal(todos[0]?.due_at, "2026-09-22T23:25:00+08:00");
  });
});
