import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";

interface Props {
  icon?: keyof typeof Feather.glyphMap;
  label: string;
  value: number | string;
  accent?: string;
  testID?: string;
}

export const KpiTile: React.FC<Props> = ({ icon = "activity", label, value, accent = colors.primary, testID }) => (
  <View style={styles.wrap} testID={testID}>
    <View style={[styles.iconWrap, { backgroundColor: `${accent}22` }]}>
      <Feather name={icon} size={18} color={accent} />
    </View>
    <Text style={styles.value}>{value}</Text>
    <Text style={styles.label}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.inverted,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.borderDark,
    minHeight: 110,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  value: { color: colors.textInverse, fontSize: 30, fontWeight: "900", letterSpacing: -1 },
  label: { color: colors.textInverseSecondary, fontSize: 12, fontWeight: "500" },
});
