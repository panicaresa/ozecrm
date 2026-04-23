// Unified DateTimePicker — Faza 2.1
// Works on iOS (spinner), Android (modal), Web (text fallback).
import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform, Modal, TextInput } from "react-native";
import { Feather } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { colors, radius } from "../theme";

interface Props {
  value: Date | null;
  onChange: (next: Date | null) => void;
  mode?: "date" | "time" | "datetime";
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  testID?: string;
  allowClear?: boolean;
  label?: string;
}

function fmt(d: Date | null, mode: "date" | "time" | "datetime"): string {
  if (!d) return "";
  try {
    if (mode === "date") return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" });
    if (mode === "time") return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleString("pl-PL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return d.toISOString();
  }
}

export const DateTimeField: React.FC<Props> = ({
  value,
  onChange,
  mode = "datetime",
  placeholder = "Wybierz",
  minimumDate,
  maximumDate,
  testID,
  allowClear = true,
  label,
}) => {
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [tempDate, setTempDate] = useState<Date | null>(value);

  // Web fallback — plain HTML-like text input for dev preview
  if (Platform.OS === "web") {
    const isoLocal = value
      ? new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, mode === "date" ? 10 : 16)
      : "";
    return (
      <View>
        {label && <Text style={styles.label}>{label}</Text>}
        <TextInput
          style={styles.input}
          value={isoLocal}
          onChangeText={(v) => {
            if (!v) return onChange(null);
            const d = new Date(v);
            if (!isNaN(d.getTime())) onChange(d);
          }}
          placeholder={mode === "date" ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm"}
          placeholderTextColor={colors.textSecondary}
          testID={testID}
        />
      </View>
    );
  }

  const startPicker = () => {
    setTempDate(value || new Date());
    setShowDate(true);
  };

  const handleDateChange = (_: unknown, d?: Date) => {
    if (Platform.OS === "android") {
      setShowDate(false);
      if (!d) return;
      if (mode === "date") {
        onChange(d);
      } else {
        setTempDate(d);
        setShowTime(true);
      }
    } else {
      // iOS: live updates
      if (d) setTempDate(d);
    }
  };

  const handleTimeChange = (_: unknown, d?: Date) => {
    if (Platform.OS === "android") {
      setShowTime(false);
      if (!d || !tempDate) return;
      const merged = new Date(tempDate);
      merged.setHours(d.getHours(), d.getMinutes(), 0, 0);
      onChange(merged);
    } else {
      if (d) setTempDate(d);
    }
  };

  const confirmIOS = () => {
    setShowDate(false);
    setShowTime(false);
    if (tempDate) onChange(tempDate);
  };

  return (
    <View>
      {label && <Text style={styles.label}>{label}</Text>}
      <TouchableOpacity style={styles.input} onPress={startPicker} activeOpacity={0.7} testID={testID}>
        <Feather name={mode === "time" ? "clock" : "calendar"} size={16} color={colors.textSecondary} />
        <Text style={[styles.inputText, !value && { color: colors.textSecondary, fontWeight: "500" }]}>
          {value ? fmt(value, mode) : placeholder}
        </Text>
        {allowClear && value && (
          <TouchableOpacity onPress={() => onChange(null)} hitSlop={8}>
            <Feather name="x" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {/* Android: sequential pickers (date then time) */}
      {Platform.OS === "android" && showDate && (
        <DateTimePicker
          value={tempDate || new Date()}
          mode="date"
          display="default"
          onChange={handleDateChange}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      )}
      {Platform.OS === "android" && showTime && (
        <DateTimePicker
          value={tempDate || new Date()}
          mode="time"
          display="default"
          onChange={handleTimeChange}
        />
      )}

      {/* iOS: modal with spinner */}
      {Platform.OS === "ios" && (showDate || showTime) && (
        <Modal transparent animationType="slide" visible={showDate || showTime}>
          <View style={styles.iosBackdrop}>
            <View style={styles.iosSheet}>
              <View style={styles.iosToolbar}>
                <TouchableOpacity onPress={() => { setShowDate(false); setShowTime(false); }}>
                  <Text style={styles.iosCancel}>Anuluj</Text>
                </TouchableOpacity>
                <Text style={styles.iosTitle}>{mode === "date" ? "Data" : mode === "time" ? "Godzina" : "Data i godzina"}</Text>
                <TouchableOpacity onPress={confirmIOS}>
                  <Text style={styles.iosConfirm}>Gotowe</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate || new Date()}
                mode={mode === "time" ? "time" : "datetime"}
                display="spinner"
                onChange={handleDateChange}
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                locale="pl-PL"
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  label: { fontSize: 10, color: colors.textSecondary, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  input: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 12, backgroundColor: colors.paper,
  },
  inputText: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  iosBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  iosSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 24 },
  iosToolbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  iosCancel: { color: colors.textSecondary, fontWeight: "600", fontSize: 15 },
  iosTitle: { fontWeight: "900", fontSize: 14 },
  iosConfirm: { color: colors.primary, fontWeight: "900", fontSize: 15 },
});
