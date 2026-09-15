import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import {
  courseSpaceKey,
  monitoredCourses,
  type CourseCatalog,
} from "@chaoxing-mcp/domain";

import type { SyncSettings } from "../persist/app-store";

type Props = {
  settings: SyncSettings;
  catalog: CourseCatalog;
  onSave: (settings: SyncSettings) => Promise<void> | void;
  onToggleCourse: (courseKey: string, monitored: boolean) => Promise<void> | void;
  onRefreshCourses: () => Promise<void> | void;
  onClose: () => void;
};

export function SettingsScreen({
  settings,
  catalog,
  onSave,
  onToggleCourse,
  onRefreshCourses,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<SyncSettings>({ ...settings });
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const monitored = monitoredCourses(catalog).length;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>本地同步设置</Text>
      <Text style={styles.hint}>
        Cookie 只在安全存储里，这里不会回填。新课默认纳入监控，取消勾选即可排除。
      </Text>

      <Text style={styles.section}>
        已监控 {monitored} / {catalog.courses.length} 门课程
      </Text>
      <Pressable
        style={styles.secondary}
        disabled={refreshing}
        onPress={async () => {
          setRefreshing(true);
          try {
            await onRefreshCourses();
          } finally {
            setRefreshing(false);
          }
        }}
      >
        <Text style={styles.secondaryLabel}>
          {refreshing ? "正在刷新课程列表…" : "立即刷新课程列表"}
        </Text>
      </Pressable>
      {catalog.courses.map((preference) => {
        const key = courseSpaceKey(preference.course);
        return (
          <View key={key} style={styles.row}>
            <Text style={styles.courseTitle}>{preference.course.title || key}</Text>
            <Switch
              value={preference.monitored}
              onValueChange={(value) => {
                void onToggleCourse(key, value);
              }}
            />
          </View>
        );
      })}

      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={styles.label}>课程空间补充同步</Text>
          <Text style={styles.meta}>关闭后只扫收件箱，可能漏课。</Text>
        </View>
        <Switch
          value={draft.courseSourcesEnabled}
          onValueChange={(courseSourcesEnabled) =>
            setDraft({ ...draft, courseSourcesEnabled })
          }
        />
      </View>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={styles.label}>截止提醒</Text>
          <Text style={styles.meta}>同步后按规则预排 AlarmManager。</Text>
        </View>
        <Switch
          value={draft.remindersEnabled}
          onValueChange={(remindersEnabled) => setDraft({ ...draft, remindersEnabled })}
        />
      </View>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={styles.label}>通知显示任务详情</Text>
          <Text style={styles.meta}>关闭后锁屏只显示通用提醒。</Text>
        </View>
        <Switch
          value={draft.showNotificationDetails}
          onValueChange={(showNotificationDetails) =>
            setDraft({ ...draft, showNotificationDetails })
          }
        />
      </View>

      <LabeledNumber
        label="自动刷新间隔（分钟）"
        value={draft.refreshMinutes}
        onChange={(refreshMinutes) => setDraft({ ...draft, refreshMinutes })}
      />
      <LabeledNumber
        label="抓取页数"
        value={draft.inboxPageLimit}
        onChange={(inboxPageLimit) => setDraft({ ...draft, inboxPageLimit })}
      />
      <LabeledNumber
        label="抓取数量"
        value={draft.inboxItemLimit}
        onChange={(inboxItemLimit) => setDraft({ ...draft, inboxItemLimit })}
      />
      <LabeledNumber
        label="最多扫描课程数"
        value={draft.courseLimit}
        onChange={(courseLimit) => setDraft({ ...draft, courseLimit })}
      />

      <Pressable
        style={styles.primary}
        disabled={saving}
        onPress={async () => {
          setSaving(true);
          try {
            await onSave(draft);
            onClose();
          } finally {
            setSaving(false);
          }
        }}
      >
        <Text style={styles.primaryLabel}>{saving ? "保存中" : "保存设置"}</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={onClose}>
        <Text style={styles.secondaryLabel}>返回</Text>
      </Pressable>
    </ScrollView>
  );
}

function LabeledNumber({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={String(value)}
        onChangeText={(text) => {
          const parsed = Number.parseInt(text, 10);
          if (Number.isFinite(parsed)) {
            onChange(parsed);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 64, backgroundColor: "#f6f7fb", gap: 10 },
  title: { fontSize: 26, fontWeight: "700", color: "#1b1f24" },
  hint: { fontSize: 14, lineHeight: 20, color: "#4b5563", marginBottom: 8 },
  section: { fontSize: 16, fontWeight: "600", color: "#1b1f24", marginTop: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    borderRadius: 10,
    gap: 12,
  },
  grow: { flex: 1 },
  courseTitle: { flex: 1, fontSize: 15, color: "#111827" },
  label: { fontSize: 15, fontWeight: "600", color: "#111827" },
  meta: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  field: { backgroundColor: "#fff", borderRadius: 10, padding: 12 },
  input: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
  primary: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#1d4ed8",
    alignItems: "center",
  },
  primaryLabel: { color: "#f8fafc", fontWeight: "700" },
  secondary: {
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#93c5fd",
    alignItems: "center",
    backgroundColor: "#eff6ff",
  },
  secondaryLabel: { color: "#1d4ed8", fontWeight: "600" },
});
