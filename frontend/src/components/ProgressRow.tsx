import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";

interface RepProgress {
  user_id: string;
  name: string;
  avatar_url?: string | null;
  signed: number;
  target: number;
  percent: number;
}

export const ProgressRow: React.FC<{ rep: RepProgress; rank?: number; testID?: string }> = ({ rep, rank, testID }) => {
  const pct = Math.min(100, Math.max(0, rep.percent || 0));
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.avatarWrap}>
        {rep.avatar_url ? (
          <Image source={{ uri: rep.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={{ color: colors.textInverse, fontWeight: "700" }}>
              {rep.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
            </Text>
          </View>
        )}
        {rank && rank <= 3 && (
          <View style={[styles.medal, rank === 1 ? styles.gold : rank === 2 ? styles.silver : styles.bronze]}>
            <Feather name="award" size={11} color="#fff" />
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>{rep.name}</Text>
          <Text style={styles.pct}>{pct}%</Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.sub}>{rep.signed} / {rep.target} umów podpisanych</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  avatarWrap: { position: "relative" },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { backgroundColor: colors.inverted, alignItems: "center", justifyContent: "center" },
  medal: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  gold: { backgroundColor: "#EAB308" },
  silver: { backgroundColor: "#94A3B8" },
  bronze: { backgroundColor: "#B45309" },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  pct: { fontSize: 15, fontWeight: "900", color: colors.primary, marginLeft: 8 },
  track: { height: 10, backgroundColor: colors.zinc200, borderRadius: 999, marginTop: 6, overflow: "hidden" },
  fill: { height: 10, backgroundColor: colors.primary, borderRadius: 999 },
  sub: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
});
