import React from "react";
import { ActivityIndicator, Text, TouchableOpacity, StyleSheet, View, ViewStyle } from "react-native";
import { colors, radius } from "../theme";

interface Props {
  title: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "outline" | "dark";
  icon?: React.ReactNode;
  style?: ViewStyle;
  testID?: string;
}

export const Button: React.FC<Props> = ({ title, onPress, loading, disabled, variant = "primary", icon, style, testID }) => {
  const bg =
    variant === "primary" ? colors.primary :
    variant === "secondary" ? colors.secondary :
    variant === "dark" ? colors.inverted :
    "transparent";
  const fg = variant === "outline" ? colors.primary : colors.textInverse;
  const border = variant === "outline" ? { borderWidth: 2, borderColor: colors.primary } : null;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[styles.base, { backgroundColor: bg, opacity: disabled ? 0.5 : 1 }, border, style]}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.inner}>
          {icon}
          <Text style={[styles.text, { color: fg }]}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: { height: 56, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  inner: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: { fontSize: 16, fontWeight: "700" },
});
