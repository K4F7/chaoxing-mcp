import {
  collectDueReminders,
  markReminderSent,
  pruneReminderHistory,
  type PlannedReminder,
  type ReminderHistory,
  type SyncItem,
} from "@chaoxing-mcp/domain";

export type DesktopNotification = {
  title: string;
  body: string;
  itemId: string;
  key: string;
};

export type NotificationBridge = {
  show(notification: DesktopNotification): Promise<boolean> | boolean;
};

export function reminderNotification(
  plan: PlannedReminder,
  showDetails: boolean,
): DesktopNotification {
  const expired = plan.item.status === "authentication_expired";
  return {
    key: plan.key,
    itemId: plan.item.id,
    title: expired
      ? "学习通登录已失效"
      : plan.item.kind === "exam"
        ? "考试截止提醒"
        : "作业截止提醒",
    body: expired
      ? "请打开应用重新登录，自动同步已停止。"
      : showDetails
        ? `${plan.item.sourceTitle}\n${plan.item.title}\n截止：${formatDueAt(plan.item.dueAt)}`
        : "有一项学习任务即将截止。点击通知可在 App 内查看详情。",
  };
}

export function authenticationExpiredNotification(): DesktopNotification {
  return {
    key: "authentication-expired",
    itemId: "authentication-expired",
    title: "学习通登录已失效",
    body: "请打开应用重新登录，自动同步已停止。",
  };
}

export async function deliverDueReminders(input: {
  items: readonly SyncItem[];
  history: ReminderHistory;
  now: Date;
  showDetails: boolean;
  remindersEnabled: boolean;
  notifier: NotificationBridge;
}): Promise<ReminderHistory> {
  let history = pruneReminderHistory(input.history, input.now);
  if (!input.remindersEnabled) {
    return history;
  }
  const due = collectDueReminders({
    items: input.items,
    history,
    now: input.now,
  });
  for (const plan of due) {
    const delivered = await input.notifier.show(
      reminderNotification(plan, input.showDetails),
    );
    if (delivered) {
      history = markReminderSent(history, plan.key, input.now);
    }
  }
  return history;
}

function formatDueAt(value: Date | null): string {
  if (value == null) {
    return "时间未知";
  }
  const pad = (number: number): string => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
