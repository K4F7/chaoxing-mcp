# `@chaoxing-mcp/android-alarms`

React Native port of [ADR-0001](../../docs/adr/0001-android-prescheduled-alarms.md): pre-scheduled Android alarms for the two reminder tiers, not background fetch.

Normative product rules stay in the [daily-usable spec](../../docs/specs/2026-07-26-日常可用的学习通待办工具.md) and `packages/chaoxing-domain`. This package only maps those “schedule ahead” plans onto AlarmManager.

## Two-tier mapping

| Domain rule | Intensity | Tier name | Delivery window | AlarmManager API |
|---|---|---|---|---|
| `due-24h` | low / 静默 | `windowed` | `[due-24h, due-2h)` | `setExactAndAllowWhileIdle` |
| `due-2h` | high / 响铃 | `exact` | `[due-2h, due)` | `setExactAndAllowWhileIdle` |

`windowed` is the 24h **delivery window** from the domain planner (same catch-up rule Flutter uses). It is **not** `AlarmManager.setWindow`. Inexact windows can delay the 2h tier past due, which the spec forbids.

Both tiers still use the install-granted `USE_EXACT_ALARM` permission. The user-toggle `SCHEDULE_EXACT_ALARM` permission is blocked. If exact alarms are denied, scheduling throws; it does not fall back to `setTimeout`, WorkManager, or inexact alarms.

## JS API

```ts
import {
  ReminderAlarmScheduler,
  mapPlannedReminders,
} from "@chaoxing-mcp/android-alarms";

const { accepted, skipped } = mapPlannedReminders(planReminders({ items, history, now }), { now });
await scheduler.rescheduleAll(plans, { now });
await scheduler.list();
await scheduler.cancel(key);
```

`rescheduleAll` cancels every previously stored alarm and writes the new set (ADR-0001). The same plans produce the same `key` / `requestCode`, so the second call is idempotent.

If accepted plans exceed Android’s 500 concurrent-alarm ceiling, mapping throws `AlarmLimitExceededError` instead of dropping the tail.

## Native module

Expo module name: `ChaoxingAndroidAlarms`.

| Method | Role |
|---|---|
| `schedule` | persist + `setExactAndAllowWhileIdle` |
| `cancel` | cancel one stable key |
| `cancelAll` | cancel the stored set |
| `list` | return persisted plans |
| `rescheduleAll` | cancel-all then schedule |
| `canScheduleExactAlarms` | visible permission check |

`ChaoxingBootReceiver` re-reads the persisted set after `BOOT_COMPLETED`. Notification channels: `chaoxing-reminder-low` (IMPORTANCE_LOW) and `chaoxing-reminder-high` (IMPORTANCE_HIGH).

## Native compile gap

This increment lands the Kotlin sources, merged manifest, and Expo config plugin. A full `expo run:android` / Gradle compile was not required in the Linux agent environment and may be unavailable here (no Android SDK / emulator). Unit tests cover mapping, idempotent reschedule, and a static contract over the Kotlin/manifest/plugin files. Device verification of Doze, reboot, and channel sound remains manual.
