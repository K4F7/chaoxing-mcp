import {
  SyncItemKind,
  type PlannedReminder,
  type SyncItem,
} from "@chaoxing-mcp/domain";

export function assignmentItem(input: {
  dueAt: Date | null;
  id?: string;
  title?: string;
}): SyncItem {
  return {
    id: input.id ?? "assignment-1",
    kind: SyncItemKind.assignment,
    title: input.title ?? "作业",
    url: "https://mooc1.chaoxing.com/work",
    sourceTitle: "作业通知",
    dueAt: input.dueAt,
  };
}

export function plannedReminder(input: {
  item: SyncItem;
  ruleId: "due-24h" | "due-2h";
  triggerAt: Date;
  key?: string;
}): PlannedReminder {
  return {
    key: input.key ?? `${input.item.id}|${input.item.kind}|${input.ruleId}|due`,
    item: input.item,
    ruleId: input.ruleId,
    triggerAt: input.triggerAt,
    intensity: input.ruleId === "due-2h" ? "high" : "low",
  };
}
