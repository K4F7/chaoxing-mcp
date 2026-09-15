import {
  addHours,
  ReminderIntensity,
  type PlannedReminder,
} from "@chaoxing-mcp/domain";

import { AlarmLimitExceededError } from "./errors";
import { assertUniqueRequestCodes, stableRequestCode } from "./request-code";
import {
  ANDROID_CONCURRENT_ALARM_LIMIT,
  REMINDER_CHANNEL_HIGH,
  REMINDER_CHANNEL_LOW,
  type AlarmMappingResult,
  type AlarmSkip,
  type AlarmTier,
  type AndroidAlarmPlan,
  type ReminderChannelId,
} from "./types";

export type MapAlarmOptions = {
  now: Date;
  showDetails?: boolean;
  limit?: number;
};

export function deliveryWindowEnd(plan: PlannedReminder): Date | null {
  const dueAt = plan.item.dueAt;
  if (dueAt === null) {
    return null;
  }
  return plan.ruleId === "due-24h" ? addHours(dueAt, -2) : dueAt;
}

export function alarmTierForPlan(plan: PlannedReminder): AlarmTier {
  return plan.intensity === ReminderIntensity.high ? "exact" : "windowed";
}

export function channelIdForIntensity(
  intensity: PlannedReminder["intensity"],
): ReminderChannelId {
  return intensity === ReminderIntensity.high
    ? REMINDER_CHANNEL_HIGH
    : REMINDER_CHANNEL_LOW;
}

export function formatDueAt(value: Date | null): string {
  if (value === null) {
    return "时间未知";
  }
  const pad = (number: number): string => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function reminderNotificationCopy(
  plan: PlannedReminder,
  showDetails: boolean,
): { title: string; body: string } {
  const title =
    plan.item.kind === "exam" ? "考试截止提醒" : "作业截止提醒";
  const body = showDetails
    ? `${plan.item.sourceTitle}\n${plan.item.title}\n截止：${formatDueAt(plan.item.dueAt)}`
    : "有一项学习任务即将截止。点击通知可在 App 内查看详情。";
  return { title, body };
}

export function mapPlannedReminder(
  plan: PlannedReminder,
  now: Date,
  showDetails = false,
): AndroidAlarmPlan | AlarmSkip {
  const dueAt = plan.item.dueAt;
  if (dueAt === null) {
    return {
      key: plan.key,
      reason: "missing-due",
      detail: "没有截止时间的待办事项不参与提醒。",
    };
  }
  if (dueAt.getTime() <= now.getTime()) {
    return {
      key: plan.key,
      reason: "past-due",
      detail: "已经过期的事项不再提醒。",
    };
  }
  const windowEnd = deliveryWindowEnd(plan);
  if (windowEnd === null || now.getTime() >= windowEnd.getTime()) {
    return {
      key: plan.key,
      reason: "window-closed",
      detail:
        plan.ruleId === "due-24h"
          ? "24 小时档只在截止前 24 小时到截止前 2 小时之间投递。"
          : "2 小时档只在截止前投递。",
    };
  }

  const triggerAtMs = Math.max(plan.triggerAt.getTime(), now.getTime());
  const copy = reminderNotificationCopy(plan, showDetails);
  return {
    key: plan.key,
    requestCode: stableRequestCode(plan.key),
    triggerAtMs,
    windowEndMs: windowEnd.getTime(),
    tier: alarmTierForPlan(plan),
    intensity: plan.intensity,
    channelId: channelIdForIntensity(plan.intensity),
    itemId: plan.item.id,
    itemKind: plan.item.kind,
    ruleId: plan.ruleId,
    title: copy.title,
    body: copy.body,
    showDetails,
    alarmManagerApi: "setExactAndAllowWhileIdle",
  };
}

export function mapPlannedReminders(
  plans: readonly PlannedReminder[],
  options: MapAlarmOptions,
): AlarmMappingResult {
  const showDetails = options.showDetails ?? false;
  const accepted: AndroidAlarmPlan[] = [];
  const skipped: AlarmSkip[] = [];

  for (const plan of plans) {
    const mapped = mapPlannedReminder(plan, options.now, showDetails);
    if ("reason" in mapped) {
      skipped.push(mapped);
    } else {
      accepted.push(mapped);
    }
  }

  accepted.sort((left, right) => {
    const timeOrder = left.triggerAtMs - right.triggerAtMs;
    return timeOrder !== 0 ? timeOrder : left.key.localeCompare(right.key);
  });

  const limit = options.limit ?? ANDROID_CONCURRENT_ALARM_LIMIT;
  if (accepted.length > limit) {
    throw new AlarmLimitExceededError(accepted.length, limit);
  }
  assertUniqueRequestCodes(accepted);
  return { accepted, skipped };
}
