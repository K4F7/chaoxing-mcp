import {
  emptyReminderHistory,
  type ReminderHistory,
} from "@chaoxing-mcp/domain";

export function reminderHistoryFromJson(value: unknown): ReminderHistory {
  if (value === null || typeof value !== "object") {
    return emptyReminderHistory();
  }
  const raw = (value as { sent?: unknown }).sent;
  if (raw === null || typeof raw !== "object") {
    return emptyReminderHistory();
  }
  const sent: Record<string, Date> = {};
  for (const [key, stamp] of Object.entries(raw)) {
    if (typeof stamp !== "string" || stamp.length === 0) {
      continue;
    }
    const parsed = new Date(stamp);
    if (!Number.isNaN(parsed.getTime())) {
      sent[key] = parsed;
    }
  }
  return { sent };
}

export function reminderHistoryToJson(
  history: ReminderHistory,
): Record<string, unknown> {
  return {
    sent: Object.fromEntries(
      Object.entries(history.sent).map(([key, sentAt]) => [
        key,
        sentAt.toISOString(),
      ]),
    ),
  };
}
