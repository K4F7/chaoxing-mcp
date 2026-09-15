import {
  MemoryAlarmBackend,
  NativeAlarmBackend,
  ReminderAlarmScheduler,
  UnsupportedAlarmBackend,
  mapPlannedReminders,
  type AlarmBackend,
  type AlarmMappingResult,
  type AndroidAlarmPlan,
  type NativeAlarmModule,
  type RescheduleResult,
} from "@chaoxing-mcp/android-alarms";
import {
  emptyReminderHistory,
  planReminders,
  type PlannedReminder,
} from "@chaoxing-mcp/domain";

import { sampleTodos } from "./preview";

export type FixtureAlarmPreview = {
  planned: PlannedReminder[];
  mapping: AlarmMappingResult;
};

export function planFixtureAlarms(
  now: Date,
  showDetails = true,
): FixtureAlarmPreview {
  const planned = planReminders({
    items: sampleTodos(now),
    history: emptyReminderHistory(),
    now,
  });
  return {
    planned,
    mapping: mapPlannedReminders(planned, { now, showDetails }),
  };
}

export function createAlarmBackend(
  nativeModule: NativeAlarmModule | null | undefined,
): AlarmBackend {
  return nativeModule
    ? new NativeAlarmBackend(nativeModule)
    : new UnsupportedAlarmBackend();
}

export function createFixtureAlarmScheduler(
  backend: AlarmBackend = new MemoryAlarmBackend(),
): ReminderAlarmScheduler {
  return new ReminderAlarmScheduler(backend);
}

export async function registerFixtureAlarms(
  scheduler: ReminderAlarmScheduler,
  now: Date,
  showDetails = true,
): Promise<RescheduleResult> {
  const { planned } = planFixtureAlarms(now, showDetails);
  return scheduler.rescheduleAll(planned, { now, showDetails });
}

export async function registerLiveAlarms(
  scheduler: ReminderAlarmScheduler,
  items: Parameters<typeof planReminders>[0]["items"],
  history: Parameters<typeof planReminders>[0]["history"],
  now: Date,
  showDetails = false,
): Promise<RescheduleResult> {
  const planned = planReminders({ items, history, now });
  return scheduler.rescheduleAll(planned, { now, showDetails });
}

export function summarizeAlarmPlan(plan: AndroidAlarmPlan): string {
  return `${plan.ruleId} · ${plan.tier} · ${plan.alarmManagerApi}`;
}
