import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, radius, spacing, statusColor, statusLabel } from "../theme";

export interface MapPin {
  id: string;
  lat?: number | null;
  lng?: number | null;
  status?: string;
  client_name?: string;
}

interface Props {
  pins: MapPin[];
  height?: number;
  testID?: string;
  selectedId?: string | null;
  onSelectPin?: (id: string | null) => void;
}

// Web fallback: shows pins as a list with coords. Native version lives in LeadMap.native.tsx.
export const LeadMap: React.FC<Props> = ({ pins, height = 280, testID, selectedId, onSelectPin }) => {
  const valid = pins.filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
  return (
    <View style={[styles.wrap, { minHeight: height }]} testID={testID}>
      <View style={styles.header}>
        <Feather name="map" size={14} color={colors.textInverseSecondary} />
        <Text style={styles.headerText}>LEAD MAP · {valid.length} pinezek</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 8 }}>
        {valid.slice(0, 20).map((p) => {
          const c = statusColor[p.status || ""] || colors.primary;
          const active = selectedId === p.id;
          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.row, active && { borderColor: c, backgroundColor: "#13294B" }]}
              activeOpacity={0.7}
              onPress={() => onSelectPin?.(active ? null : p.id)}
              testID={`map-pin-${p.id}`}
            >
              <View style={[styles.dot, { backgroundColor: c }]} />
              <Text style={styles.name} numberOfLines={1}>{p.client_name || "—"}</Text>
              <Text style={styles.coords}>
                {p.lat!.toFixed(3)}, {p.lng!.toFixed(3)}
              </Text>
              <Text style={[styles.status, { color: c }]}>{statusLabel[p.status || ""] || p.status}</Text>
            </TouchableOpacity>
          );
        })}
        {valid.length === 0 && (
          <Text style={{ color: colors.textInverseSecondary, textAlign: "center", marginTop: 20 }}>
            Brak leadów z lokalizacją.
          </Text>
        )}
      </ScrollView>
      <Text style={styles.hint}>
        Mapa interaktywna z klastrowaniem dostępna w podglądzie mobilnym (Expo Go · iOS/Android).
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.inverted, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.borderDark },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderDark },
  headerText: { color: colors.textInverseSecondary, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: "#18181b", borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderDark },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, color: colors.textInverse, fontSize: 13, fontWeight: "600" },
  coords: { color: colors.textInverseSecondary, fontSize: 11 },
  status: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  hint: { color: colors.textInverseSecondary, fontSize: 10, textAlign: "center", padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderDark },
});
