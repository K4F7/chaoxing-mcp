import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addHours,
  emptyReminderHistory,
  planReminders,
} from "@chaoxing-mcp/domain";

import {
  ExactAlarmPermissionError,
  MemoryAlarmBackend,
  ReminderAlarmScheduler,
  UnsupportedAlarmBackend,
  UnsupportedAlarmBackendError,
} from "../src/index";
import { assignmentItem, plannedReminder } from "./helpers";

describe("ReminderAlarmScheduler.rescheduleAll", () => {
  test("is idempotent for the same planned reminders", async () => {
    const now = new Date(2026, 6, 27, 9);
    const planned = planReminders({
      items: [
        assignmentItem({ dueAt: addHours(now, 25), id: "day" }),
        assignmentItem({ dueAt: addHours(now, 3), id: "soon" }),
      ],
      history: emptyReminderHistory(),
      now,
    });
    const backend = new MemoryAlarmBackend();
    const scheduler = new ReminderAlarmScheduler(backend);

    const first = await scheduler.rescheduleAll(planned, { now });
    const afterFirst = await scheduler.list();
    const second = await scheduler.rescheduleAll(planned, { now });
    const afterSecond = await scheduler.list();

    assert.deepEqual(
      afterSecond.map((plan) => [plan.key, plan.requestCode, plan.triggerAtMs]),
      afterFirst.map((plan) => [plan.key, plan.requestCode, plan.triggerAtMs]),
    );
    assert.deepEqual(
      first.scheduled.map((plan) => plan.key),
      second.scheduled.map((plan) => plan.key),
    );
    assert.equal(afterSecond.length, first.scheduled.length);
  });

  test("cancels orphan alarms when the next full reschedule drops them", async () => {
    const now = new Date(2026, 6, 27, 9);
    const keep = assignmentItem({ dueAt: addHours(now, 25), id: "keep" });
    const drop = assignmentItem({ dueAt: addHours(now, 26), id: "drop" });
    const backend = new MemoryAlarmBackend();
    const scheduler = new ReminderAlarmScheduler(backend);

    await scheduler.rescheduleAll(
      planReminders({
        items: [keep, drop],
        history: emptyReminderHistory(),
        now,
      }),
      { now },
    );
    await scheduler.rescheduleAll(
      planReminders({
        items: [keep],
        history: emptyReminderHistory(),
        now,
      }),
      { now },
    );

    const listed = await scheduler.list();
    assert.ok(listed.every((plan) => plan.itemId === "keep"));
    assert.ok(listed.every((plan) => !plan.key.includes("drop")));
    assert.equal(listed.length, 2);
  });

  test("reuses the same requestCode so cancel can hit the previous alarm", async () => {
    const now = new Date(2026, 6, 27, 9);
    const item = assignmentItem({ dueAt: addHours(now, 25), id: "stable" });
    const planned = planReminders({
      items: [item],
      history: emptyReminderHistory(),
      now,
    });
    const backend = new MemoryAlarmBackend();
    const scheduler = new ReminderAlarmScheduler(backend);

    const first = await scheduler.rescheduleAll(planned, { now });
    const second = await scheduler.rescheduleAll(planned, { now });
    assert.deepEqual(
      second.scheduled.map((plan) => plan.requestCode),
      first.scheduled.map((plan) => plan.requestCode),
    );
  });

  test("refuses to schedule when exact alarms are not granted", async () => {
    const now = new Date(2026, 6, 27, 9);
    const backend = new MemoryAlarmBackend();
    backend.exactAlarmsAllowed = false;
    const scheduler = new ReminderAlarmScheduler(backend);

    await assert.rejects(
      () =>
        scheduler.rescheduleAll(
          [
            plannedReminder({
              item: assignmentItem({ dueAt: addHours(now, 25) }),
              ruleId: "due-2h",
              triggerAt: addHours(now, 23),
            }),
          ],
          { now },
        ),
      ExactAlarmPermissionError,
    );
    assert.deepEqual(await backend.list(), []);
  });

  test("does not pretend setTimeout is an alarm on unsupported runtimes", async () => {
    const now = new Date(2026, 6, 27, 9);
    const scheduler = new ReminderAlarmScheduler(new UnsupportedAlarmBackend());

    await assert.rejects(
      () =>
        scheduler.rescheduleAll(
          [
            plannedReminder({
              item: assignmentItem({ dueAt: addHours(now, 25) }),
              ruleId: "due-2h",
              triggerAt: addHours(now, 23),
            }),
          ],
          { now },
        ),
      (error: unknown) => {
        assert.ok(error instanceof UnsupportedAlarmBackendError);
        assert.match(error.message, /不能用 setTimeout/);
        return true;
      },
    );
  });
});
