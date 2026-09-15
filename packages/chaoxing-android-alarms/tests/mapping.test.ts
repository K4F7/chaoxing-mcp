import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addHours,
  emptyReminderHistory,
  planReminders,
  ReminderIntensity,
} from "@chaoxing-mcp/domain";

import {
  AlarmLimitExceededError,
  ANDROID_CONCURRENT_ALARM_LIMIT,
  REMINDER_CHANNEL_HIGH,
  REMINDER_CHANNEL_LOW,
  RequestCodeCollisionError,
  assertUniqueRequestCodes,
  mapPlannedReminder,
  mapPlannedReminders,
  stableRequestCode,
} from "../src/index";
import { assignmentItem, plannedReminder } from "./helpers";

describe("mapPlannedReminders", () => {
  test("maps 24h low to windowed and 2h high to exact AlarmManager plans", () => {
    const now = new Date(2026, 6, 27, 9);
    const dueAt = addHours(now, 25);
    const item = assignmentItem({ dueAt, id: "day" });
    const planned = planReminders({
      items: [item],
      history: emptyReminderHistory(),
      now,
    });

    const mapped = mapPlannedReminders(planned, { now });

    assert.deepEqual(
      mapped.accepted.map((plan) => [
        plan.ruleId,
        plan.tier,
        plan.intensity,
        plan.channelId,
        plan.alarmManagerApi,
      ]),
      [
        [
          "due-24h",
          "windowed",
          ReminderIntensity.low,
          REMINDER_CHANNEL_LOW,
          "setExactAndAllowWhileIdle",
        ],
        [
          "due-2h",
          "exact",
          ReminderIntensity.high,
          REMINDER_CHANNEL_HIGH,
          "setExactAndAllowWhileIdle",
        ],
      ],
    );
    assert.equal(mapped.accepted[0].triggerAtMs, addHours(now, 1).getTime());
    assert.equal(mapped.accepted[0].windowEndMs, addHours(dueAt, -2).getTime());
    assert.equal(mapped.accepted[1].triggerAtMs, addHours(now, 23).getTime());
    assert.equal(mapped.accepted[1].windowEndMs, dueAt.getTime());
    assert.equal(mapped.skipped.length, 0);
    assert.equal(
      mapped.accepted[0].requestCode,
      stableRequestCode(mapped.accepted[0].key),
    );
  });

  test("catches up a 24h windowed plan already inside its delivery window", () => {
    const now = new Date(2026, 6, 27, 9);
    const dueAt = addHours(now, 20);
    const item = assignmentItem({ dueAt });
    const planned = plannedReminder({
      item,
      ruleId: "due-24h",
      triggerAt: addHours(dueAt, -24),
    });

    const mapped = mapPlannedReminder(planned, now);
    assert.ok(!("reason" in mapped));
    assert.equal(mapped.tier, "windowed");
    assert.equal(mapped.triggerAtMs, now.getTime());
    assert.equal(mapped.windowEndMs, addHours(dueAt, -2).getTime());
  });

  test("skips a 24h plan after the delivery window closes at due-2h", () => {
    const now = new Date(2026, 6, 27, 9);
    const dueAt = addHours(now, 1);
    const planned = plannedReminder({
      item: assignmentItem({ dueAt }),
      ruleId: "due-24h",
      triggerAt: addHours(dueAt, -24),
    });

    const mapped = mapPlannedReminder(planned, now);
    assert.ok("reason" in mapped);
    assert.equal(mapped.reason, "window-closed");
  });

  test("keeps the exact 2h plan when the 24h window has already closed", () => {
    const now = new Date(2026, 6, 27, 9);
    const dueAt = addHours(now, 1);
    const item = assignmentItem({ dueAt, id: "soon" });
    const mapped = mapPlannedReminders(
      [
        plannedReminder({
          item,
          ruleId: "due-24h",
          triggerAt: addHours(dueAt, -24),
        }),
        plannedReminder({
          item,
          ruleId: "due-2h",
          triggerAt: addHours(dueAt, -2),
        }),
      ],
      { now },
    );

    assert.deepEqual(
      mapped.accepted.map((plan) => [plan.ruleId, plan.tier]),
      [["due-2h", "exact"]],
    );
    assert.equal(mapped.accepted[0].triggerAtMs, now.getTime());
    assert.equal(mapped.skipped[0].reason, "window-closed");
  });

  test("skips items that are already due", () => {
    const now = new Date(2026, 6, 27, 9);
    const mapped = mapPlannedReminder(
      plannedReminder({
        item: assignmentItem({ dueAt: now }),
        ruleId: "due-2h",
        triggerAt: addHours(now, -2),
      }),
      now,
    );
    assert.ok("reason" in mapped);
    assert.equal(mapped.reason, "past-due");
  });

  test("hides course and assignment names unless details are requested", () => {
    const now = new Date(2026, 6, 27, 9);
    const item = assignmentItem({
      dueAt: addHours(now, 25),
      title: "线性代数作业 3",
    });
    const planned = plannedReminder({
      item,
      ruleId: "due-2h",
      triggerAt: addHours(now, 23),
    });

    const hidden = mapPlannedReminder(planned, now, false);
    const shown = mapPlannedReminder(planned, now, true);
    assert.ok(!("reason" in hidden) && !("reason" in shown));
    assert.equal(hidden.title, "作业截止提醒");
    assert.match(hidden.body, /即将截止/);
    assert.doesNotMatch(hidden.body, /线性代数/);
    assert.match(shown.body, /线性代数作业 3/);
  });

  test("fails visibly when accepted plans exceed the Android concurrent limit", () => {
    const now = new Date(2026, 6, 27, 9);
    const plans = Array.from({ length: ANDROID_CONCURRENT_ALARM_LIMIT + 1 }, (_, index) =>
      plannedReminder({
        item: assignmentItem({
          dueAt: addHours(now, 25),
          id: `item-${index}`,
        }),
        ruleId: "due-2h",
        triggerAt: addHours(now, 23),
        key: `item-${index}|assignment|due-2h|${index}`,
      }),
    );

    assert.throws(
      () => mapPlannedReminders(plans, { now }),
      (error: unknown) => {
        assert.ok(error instanceof AlarmLimitExceededError);
        assert.equal(error.plannedCount, ANDROID_CONCURRENT_ALARM_LIMIT + 1);
        assert.match(error.message, /不会悄悄丢掉/);
        return true;
      },
    );
  });

  test("fails visibly when two reminder keys collapse to one requestCode", () => {
    assert.throws(
      () =>
        assertUniqueRequestCodes([
          { key: "assignment-a|due-24h", requestCode: 42 },
          { key: "assignment-b|due-2h", requestCode: 42 },
        ]),
      (error: unknown) => {
        assert.ok(error instanceof RequestCodeCollisionError);
        assert.match(error.message, /requestCode/);
        return true;
      },
    );
  });
});
