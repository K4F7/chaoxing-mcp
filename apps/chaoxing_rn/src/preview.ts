import {
  addHours,
  emptyReminderHistory,
  isTrustedChaoxingUrl,
  planReminders,
  ReminderIntensity,
  SyncItemKind,
  type PlannedReminder,
  type SyncItem,
} from "@chaoxing-mcp/domain";

export type ReminderPreviewRow = {
  key: string;
  title: string;
  ruleId: string;
  intensityLabel: string;
  triggerAt: Date;
};

export type UrlTrustRow = {
  url: string;
  trusted: boolean;
};

export type ReminderPreview = {
  items: SyncItem[];
  reminders: ReminderPreviewRow[];
  urlChecks: UrlTrustRow[];
};

const intensityLabel: Record<typeof ReminderIntensity.low | typeof ReminderIntensity.high, string> =
  {
    [ReminderIntensity.low]: "静默",
    [ReminderIntensity.high]: "响铃",
  };

export function sampleTodos(now: Date): SyncItem[] {
  return [
    {
      id: "assignment-linear",
      kind: SyncItemKind.assignment,
      title: "线性代数作业 3",
      url: "https://mooc1.chaoxing.com/work",
      sourceTitle: "收件箱",
      dueAt: addHours(now, 25),
    },
    {
      id: "exam-physics",
      kind: SyncItemKind.exam,
      title: "大学物理测验",
      url: "https://mooc1-12.chaoxing.com/exam",
      sourceTitle: "受监控课程",
      dueAt: addHours(now, 3),
    },
    {
      id: "assignment-untrusted",
      kind: SyncItemKind.assignment,
      title: "第三方链接示例",
      url: "https://evil.example/work",
      sourceTitle: "收件箱",
      dueAt: addHours(now, 30),
    },
  ];
}

export function toReminderPreviewRow(plan: PlannedReminder): ReminderPreviewRow {
  return {
    key: plan.key,
    title: plan.item.title,
    ruleId: plan.ruleId,
    intensityLabel: intensityLabel[plan.intensity],
    triggerAt: plan.triggerAt,
  };
}

export function buildReminderPreview(now: Date): ReminderPreview {
  const items = sampleTodos(now);
  return {
    items,
    reminders: planReminders({
      items,
      history: emptyReminderHistory(),
      now,
    }).map(toReminderPreviewRow),
    urlChecks: items.map((item) => ({
      url: item.url,
      trusted: isTrustedChaoxingUrl(item.url),
    })),
  };
}
