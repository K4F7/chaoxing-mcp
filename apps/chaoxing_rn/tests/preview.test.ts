import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { addHours } from "@chaoxing-mcp/domain";

import { buildReminderPreview } from "../src/preview";

describe("reminder preview", () => {
  test("plans both reminder rules for fixture 待办事项", () => {
    const now = new Date(2026, 6, 27, 9);
    const preview = buildReminderPreview(now);

    assert.deepEqual(
      preview.reminders.map((row) => [row.title, row.ruleId]),
      [
        ["大学物理测验", "due-24h"],
        ["线性代数作业 3", "due-24h"],
        ["大学物理测验", "due-2h"],
        ["第三方链接示例", "due-24h"],
        ["线性代数作业 3", "due-2h"],
        ["第三方链接示例", "due-2h"],
      ],
    );
    assert.equal(
      preview.reminders.find(
        (row) => row.title === "线性代数作业 3" && row.ruleId === "due-24h",
      )?.triggerAt.getTime(),
      addHours(now, 1).getTime(),
    );
  });

  test("marks only 学习通 hosts as trusted", () => {
    const preview = buildReminderPreview(new Date(2026, 6, 27, 9));
    assert.deepEqual(
      preview.urlChecks.map((row) => row.trusted),
      [true, true, false],
    );
  });
});
