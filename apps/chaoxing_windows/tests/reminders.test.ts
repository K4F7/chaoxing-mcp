import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  emptyReminderHistory,
  reminderKey,
  SyncItemKind,
  type SyncItem,
} from "@chaoxing-mcp/domain";

import {
  deliverDueReminders,
  reminderNotification,
} from "../src/reminders";

function assignment(now: Date, hoursUntilDue: number): SyncItem {
  return {
    id: "work-1",
    kind: SyncItemKind.assignment,
    title: "作业",
    url: "https://mooc1.chaoxing.com/work",
    sourceTitle: "线性代数",
    dueAt: new Date(now.getTime() + hoursUntilDue * 3600_000),
    displayStatus: "upcoming",
  };
}

describe("Windows due-now reminders", () => {
  test("fires the 24h rule once and hides details by default", async () => {
    const now = new Date(2026, 7, 21, 9);
    const item = assignment(now, 23);
    const shown: string[] = [];
    const history = await deliverDueReminders({
      items: [item],
      history: emptyReminderHistory(),
      now,
      showDetails: false,
      remindersEnabled: true,
      notifier: {
        show(notification: { title: string; body: string }) {
          shown.push(notification.body);
          return true;
        },
      },
    });
    assert.equal(shown.length, 1);
    assert.match(shown[0] ?? "", /即将截止/);
    assert.doesNotMatch(shown[0] ?? "", /线性代数/);
    const key = reminderKey(item, "due-24h", item.dueAt!);
    assert.ok(history.sent[key]);
  });

  test("does not fire when reminders are paused", async () => {
    let shown = 0;
    await deliverDueReminders({
      items: [assignment(new Date(2026, 7, 21, 9), 1)],
      history: emptyReminderHistory(),
      now: new Date(2026, 7, 21, 9),
      showDetails: true,
      remindersEnabled: false,
      notifier: {
        show() {
          shown += 1;
          return true;
        },
      },
    });
    assert.equal(shown, 0);
  });

  test("detail copy never includes Cookie", () => {
    const now = new Date(2026, 7, 21, 9);
    const item = assignment(now, 1);
    const note = reminderNotification(
      {
        key: "k",
        item,
        ruleId: "due-2h",
        triggerAt: now,
        intensity: "high",
      },
      true,
    );
    assert.doesNotMatch(note.body, /Cookie/i);
  });
});
