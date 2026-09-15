import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SyncDisplayStatus, SyncItemKind, type SyncItem } from "@chaoxing-mcp/domain";

import { groupTodoItems, trustedItemUrl } from "../src/sync/todo-groups";

function item(id: string, status: SyncItem["displayStatus"]): SyncItem {
  return {
    id,
    kind: SyncItemKind.assignment,
    title: id,
    url: "https://mooc1.chaoxing.com/work",
    sourceTitle: "收件箱",
    dueAt: new Date(2026, 7, 22),
    displayStatus: status,
  };
}

describe("待办 list grouping and URL trust", () => {
  test("groups merged sync items by display status", () => {
    const groups = groupTodoItems([
      item("later", SyncDisplayStatus.upcoming),
      item("late", SyncDisplayStatus.overdue),
      item("today", SyncDisplayStatus.today),
    ]);
    assert.deepEqual(
      groups.map((group) => [group.id, group.items.map((row) => row.id)]),
      [
        ["overdue", ["late"]],
        ["today", ["today"]],
        ["upcoming", ["later"]],
      ],
    );
  });

  test("only trusted 学习通 links are openable", () => {
    assert.equal(trustedItemUrl("https://mooc1.chaoxing.com/work") != null, true);
    assert.equal(trustedItemUrl("http://mooc1.chaoxing.com/work"), null);
    assert.equal(trustedItemUrl("https://evil.example/work"), null);
  });
});
