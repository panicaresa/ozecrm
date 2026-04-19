import React from "react";
import { View, Text, TextInput, TextInputProps, StyleSheet } from "react-native";
import { colors, radius } from "../theme";

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  right?: React.ReactNode;
}

export const Field: React.FC<Props> = ({ label, error, right, style, ...input }) => {
  return (
    <View style={styles.wrap}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.inputWrap, !!error && styles.error]}>
        <TextInput
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, style]}
          {...input}
        />
        {right}
      </View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "700", color: colors.textPrimary, textTransform: "uppercase", letterSpacing: 0.5 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.paper, borderRadius: radius.md, paddingHorizontal: 12, minHeight: 52 },
  input: { flex: 1, fontSize: 16, color: colors.textPrimary, paddingVertical: 12 },
  error: { borderColor: colors.error },
  errorText: { color: colors.error, fontSize: 12 },
});
