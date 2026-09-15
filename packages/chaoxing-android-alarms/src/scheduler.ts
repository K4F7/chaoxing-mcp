import { type PlannedReminder } from "@chaoxing-mcp/domain";

import { ExactAlarmPermissionError } from "./errors";
import { mapPlannedReminders, type MapAlarmOptions } from "./mapping";
import {
  type AlarmBackend,
  type AndroidAlarmPlan,
  type RescheduleResult,
} from "./types";

export class ReminderAlarmScheduler {
  private readonly backend: AlarmBackend;

  constructor(backend: AlarmBackend) {
    this.backend = backend;
  }

  async schedule(
    plan: PlannedReminder,
    options: MapAlarmOptions,
  ): Promise<RescheduleResult> {
    const mapped = mapPlannedReminders([plan], options);
    if (mapped.accepted.length === 1) {
      await this.assertExactAlarmsAllowed();
      await this.backend.schedule(mapped.accepted[0]);
    }
    return { scheduled: mapped.accepted, skipped: mapped.skipped };
  }

  async cancel(key: string): Promise<void> {
    await this.backend.cancel(key);
  }

  async list(): Promise<AndroidAlarmPlan[]> {
    return this.backend.list();
  }

  /**
   * Cancel every previously scheduled reminder and replace them with `plans`.
   * Calling twice with the same plans is a no-op on the resulting alarm set.
   */
  async rescheduleAll(
    plans: readonly PlannedReminder[],
    options: MapAlarmOptions,
  ): Promise<RescheduleResult> {
    const mapped = mapPlannedReminders(plans, options);
    if (mapped.accepted.length > 0) {
      await this.assertExactAlarmsAllowed();
    }
    await this.backend.cancelAll();
    for (const plan of mapped.accepted) {
      await this.backend.schedule(plan);
    }
    return { scheduled: mapped.accepted, skipped: mapped.skipped };
  }

  private async assertExactAlarmsAllowed(): Promise<void> {
    const allowed = await this.backend.canScheduleExactAlarms();
    if (!allowed) {
      throw new ExactAlarmPermissionError();
    }
  }
}
