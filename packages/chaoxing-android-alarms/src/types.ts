import { type ReminderIntensity } from "@chaoxing-mcp/domain";

/** Android's documented per-app concurrent alarm ceiling. */
export const ANDROID_CONCURRENT_ALARM_LIMIT = 500;

export const REMINDER_CHANNEL_LOW = "chaoxing-reminder-low";
export const REMINDER_CHANNEL_HIGH = "chaoxing-reminder-high";

/**
 * Domain two-tier mapping onto Android alarms.
 *
 * `exact` is the 2h / high-intensity rule: fire at the planned instant.
 * `windowed` is the 24h / low-intensity rule: valid from trigger until due-2h.
 *
 * Both tiers use AlarmManager.setExactAndAllowWhileIdle. Windowed does **not**
 * mean AlarmManager.setWindow — inexact windows can delay the 2h rule past
 * due, which the daily-usable spec forbids.
 */
export type AlarmTier = "exact" | "windowed";

export type AlarmManagerApi = "setExactAndAllowWhileIdle";

export type ReminderChannelId =
  | typeof REMINDER_CHANNEL_LOW
  | typeof REMINDER_CHANNEL_HIGH;

export type AndroidAlarmPlan = {
  key: string;
  requestCode: number;
  triggerAtMs: number;
  windowEndMs: number;
  tier: AlarmTier;
  intensity: ReminderIntensity;
  channelId: ReminderChannelId;
  itemId: string;
  itemKind: string;
  ruleId: string;
  title: string;
  body: string;
  showDetails: boolean;
  alarmManagerApi: AlarmManagerApi;
};

export type AlarmSkipReason =
  | "missing-due"
  | "past-due"
  | "window-closed";

export type AlarmSkip = {
  key: string;
  reason: AlarmSkipReason;
  detail: string;
};

export type AlarmMappingResult = {
  accepted: AndroidAlarmPlan[];
  skipped: AlarmSkip[];
};

export type RescheduleResult = {
  scheduled: AndroidAlarmPlan[];
  skipped: AlarmSkip[];
};

export interface AlarmBackend {
  schedule(plan: AndroidAlarmPlan): Promise<void>;
  cancel(key: string): Promise<void>;
  cancelAll(): Promise<void>;
  list(): Promise<AndroidAlarmPlan[]>;
  canScheduleExactAlarms(): Promise<boolean>;
}
