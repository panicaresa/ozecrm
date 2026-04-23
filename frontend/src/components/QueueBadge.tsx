// Sprint 1.5 — visual badge for offline queue status (topbar).
// Renders nothing when the queue is empty; tapping navigates to /sync-status.

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQueue } from "../lib/useQueue";
import { colors, radius } from "../theme";

export const QueueBadge: React.FC<{ testID?: string }> = ({ testID }) => {
  const router = useRouter();
  const { counts } = useQueue();
  if (counts.total === 0) return null;

  // Prioritize: conflict > syncing > pending (so the user sees what's urgent)
  const conflict = counts.conflict > 0;
  const syncing = counts.syncing > 0;
  const tint = conflict ? "#EA580C" : syncing ? colors.secondary : "#475569";
  const bg = conflict ? "#FFF7ED" : syncing ? "#EFF6FF" : "#F1F5F9";
  const border = conflict ? "#FDBA74" : syncing ? "#BFDBFE" : colors.border;
  const label = conflict ? counts.conflict : syncing ? counts.syncing : counts.pending;

  return (
    <TouchableOpacity
      onPress={() => router.push("/sync-status" as any)}
      style={[styles.badge, { backgroundColor: bg, borderColor: border }]}
      testID={testID || "queue-badge"}
      activeOpacity={0.7}
    >
      {conflict ? (
        <Feather name="alert-triangle" size={14} color={tint} />
      ) : syncing ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <Feather name="upload-cloud" size={14} color={tint} />
      )}
      <Text style={[styles.badgeText, { color: tint }]}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  badgeText: { fontSize: 12, fontWeight: "800" },
});
