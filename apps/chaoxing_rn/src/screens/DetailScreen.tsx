import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { SyncItem } from "@chaoxing-mcp/domain";

import { formatDueAt, kindLabel, trustedItemUrl } from "../sync/todo-groups";

type Props = {
  item: SyncItem;
  onClose: () => void;
};

export function DetailScreen({ item, onClose }: Props) {
  const trustedUrl = trustedItemUrl(item.url);
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable onPress={onClose} style={styles.back}>
        <Text style={styles.backLabel}>返回待办</Text>
      </Pressable>
      <Text style={styles.kind}>{kindLabel(item)}</Text>
      <Text style={styles.title}>{item.title}</Text>
      <View style={styles.card}>
        <Row label="开始时间" value={formatDueAt(item.startAt ?? null)} />
        <Row label="截止时间" value={formatDueAt(item.dueAt)} />
        <Row label="学习通状态" value={item.status ?? "无"} />
        <Row label="来源通知" value={item.sourceTitle || "无"} />
        <Row label="通知时间" value={item.sourceSendTime ?? "无"} />
        <Row label="课程 ID" value={item.courseId ?? "无"} />
        <Row label="班级 ID" value={item.classId ?? "无"} />
        <Row label="作业/考试 ID" value={item.workId ?? item.answerId ?? "无"} />
      </View>
      <Pressable
        style={[styles.open, trustedUrl ? null : styles.openDisabled]}
        disabled={trustedUrl == null}
        onPress={() => {
          if (trustedUrl) {
            void Linking.openURL(trustedUrl);
          }
        }}
      >
        <Text style={styles.openLabel}>
          {trustedUrl ? "打开学习通链接" : "学习通链接不可用"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    paddingTop: 64,
    backgroundColor: "#f6f7fb",
  },
  back: {
    alignSelf: "flex-start",
    marginBottom: 16,
  },
  backLabel: {
    color: "#1d4ed8",
    fontWeight: "600",
  },
  kind: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1e3a8a",
  },
  title: {
    marginTop: 8,
    marginBottom: 16,
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
  },
  card: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    marginBottom: 16,
  },
  row: {
    marginBottom: 10,
  },
  rowLabel: {
    fontSize: 13,
    color: "#6b7280",
  },
  rowValue: {
    marginTop: 2,
    fontSize: 15,
    color: "#111827",
  },
  open: {
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#1d4ed8",
    alignItems: "center",
  },
  openDisabled: {
    backgroundColor: "#94a3b8",
  },
  openLabel: {
    color: "#f8fafc",
    fontWeight: "700",
  },
});
