import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MemoryAlarmBackend } from "@chaoxing-mcp/android-alarms";
import { addHours } from "@chaoxing-mcp/domain";

import {
  createFixtureAlarmScheduler,
  planFixtureAlarms,
  registerFixtureAlarms,
} from "../src/alarms";

describe("fixture 待办事项 alarm wiring", () => {
  test("maps fixture 待办事项 onto exact and windowed AlarmManager plans", () => {
    const now = new Date(2026, 6, 27, 9);
    const { mapping } = planFixtureAlarms(now, true);

    assert.deepEqual(
      mapping.accepted.map((plan) => [
        plan.itemId,
        plan.ruleId,
        plan.tier,
        plan.alarmManagerApi,
      ]),
      [
        ["exam-physics", "due-24h", "windowed", "setExactAndAllowWhileIdle"],
        [
          "assignment-linear",
          "due-24h",
          "windowed",
          "setExactAndAllowWhileIdle",
        ],
        ["exam-physics", "due-2h", "exact", "setExactAndAllowWhileIdle"],
        [
          "assignment-untrusted",
          "due-24h",
          "windowed",
          "setExactAndAllowWhileIdle",
        ],
        [
          "assignment-linear",
          "due-2h",
          "exact",
          "setExactAndAllowWhileIdle",
        ],
        [
          "assignment-untrusted",
          "due-2h",
          "exact",
          "setExactAndAllowWhileIdle",
        ],
      ],
    );
    assert.equal(
      mapping.accepted.find(
        (plan) =>
          plan.itemId === "assignment-linear" && plan.ruleId === "due-24h",
      )?.triggerAtMs,
      addHours(now, 1).getTime(),
    );
    assert.equal(
      mapping.accepted.find(
        (plan) => plan.itemId === "exam-physics" && plan.ruleId === "due-24h",
      )?.triggerAtMs,
      now.getTime(),
    );
    assert.equal(mapping.skipped.length, 0);
  });

  test("registers fixture plans through rescheduleAll and stays idempotent", async () => {
    const now = new Date(2026, 6, 27, 9);
    const backend = new MemoryAlarmBackend();
    const scheduler = createFixtureAlarmScheduler(backend);

    const first = await registerFixtureAlarms(scheduler, now, true);
    const second = await registerFixtureAlarms(scheduler, now, true);
    const listed = await scheduler.list();

    assert.equal(first.scheduled.length, 6);
    assert.deepEqual(
      listed.map((plan) => [plan.key, plan.requestCode]),
      first.scheduled.map((plan) => [plan.key, plan.requestCode]),
    );
    assert.deepEqual(
      second.scheduled.map((plan) => plan.requestCode),
      first.scheduled.map((plan) => plan.requestCode),
    );
    assert.ok(
      listed.every((plan) => plan.alarmManagerApi === "setExactAndAllowWhileIdle"),
    );
  });

  test("registers live 待办事项 rather than only fixtures", async () => {
    const now = new Date(2026, 6, 27, 9);
    const backend = new MemoryAlarmBackend();
    const scheduler = createFixtureAlarmScheduler(backend);
    const { sampleTodos } = await import("../src/preview");
    const { emptyReminderHistory } = await import("@chaoxing-mcp/domain");
    const { registerLiveAlarms } = await import("../src/alarms");

    const result = await registerLiveAlarms(
      scheduler,
      sampleTodos(now),
      emptyReminderHistory(),
      now,
      false,
    );
    assert.ok(result.scheduled.length > 0);
    assert.ok(result.scheduled.every((plan) => plan.itemId !== ""));
  });
});
