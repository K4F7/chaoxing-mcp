import {
  SyncDisplayStatus,
  isTrustedChaoxingUrl,
  type SyncItem,
} from "@chaoxing-mcp/domain";

export type TodoGroupId = "overdue" | "today" | "upcoming" | "unscheduled";

export type TodoGroup = {
  id: TodoGroupId;
  title: string;
  items: SyncItem[];
};

const groupOrder: TodoGroupId[] = [
  "overdue",
  "today",
  "upcoming",
  "unscheduled",
];

const groupTitle: Record<TodoGroupId, string> = {
  overdue: "已逾期",
  today: "今天",
  upcoming: "即将到期",
  unscheduled: "未排期",
};

export function groupTodoItems(items: readonly SyncItem[]): TodoGroup[] {
  const buckets: Record<TodoGroupId, SyncItem[]> = {
    overdue: [],
    today: [],
    upcoming: [],
    unscheduled: [],
  };
  for (const item of items) {
    buckets[groupIdFor(item)].push(item);
  }
  return groupOrder
    .map((id) => ({ id, title: groupTitle[id], items: buckets[id] }))
    .filter((group) => group.items.length > 0);
}

export function groupIdFor(item: SyncItem): TodoGroupId {
  switch (item.displayStatus) {
    case SyncDisplayStatus.overdue:
      return "overdue";
    case SyncDisplayStatus.today:
      return "today";
    case SyncDisplayStatus.upcoming:
      return "upcoming";
    default:
      return "unscheduled";
  }
}

export function trustedItemUrl(url: string): string | null {
  return isTrustedChaoxingUrl(url) ? url : null;
}

export function formatDueAt(value: Date | null): string {
  if (value === null) {
    return "未解析到截止时间";
  }
  const pad = (number: number): string => String(number).padStart(2, "0");
  return `${value.getMonth() + 1}月${value.getDate()}日 ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function kindLabel(item: SyncItem): string {
  return item.kind === "exam" ? "考试" : "作业";
}
