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

export interface RepPin {
  user_id: string;
  name: string;
  avatar_url?: string | null;
  lat: number;
  lng: number;
  battery?: number | null;
  active?: boolean;
  last_seen_seconds?: number | null;
}

export interface LayerState {
  leads: boolean;
  reps: boolean;
}

interface Props {
  pins: MapPin[];
  reps?: RepPin[];
  height?: number;
  testID?: string;
  selectedId?: string | null;
  onSelectPin?: (id: string | null) => void;
  layers?: LayerState;
  onToggleLayer?: (key: keyof LayerState) => void;
  onSelectRep?: (id: string | null) => void;
  selectedRepId?: string | null;
}

function formatLastSeen(s?: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s temu`;
  if (s < 3600) return `${Math.floor(s / 60)} min temu`;
  return `${Math.floor(s / 3600)}h temu`;
}

function formatWorkTime(s?: number | null): string {
  if (s == null) return "—";
  const h = Math.floor(s / 3600);
  if (h > 0) return `W terenie ${h}h`;
  const m = Math.floor(s / 60);
  return `Aktywny ${m}min`;
}

function repInitials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

// Web fallback (and shared layer-toggle bar used on all platforms).
export const LeadMap: React.FC<Props> = ({
  pins,
  reps = [],
  height = 320,
  testID,
  selectedId,
  onSelectPin,
  layers = { leads: true, reps: true },
  onToggleLayer,
  onSelectRep,
  selectedRepId,
}) => {
  const validLeads = pins.filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
  const validReps = reps.filter((r) => typeof r.lat === "number" && typeof r.lng === "number");

  return (
    <View style={[styles.wrap, { minHeight: height }]} testID={testID}>
      <View style={styles.header}>
        <Feather name="map" size={14} color={colors.textInverseSecondary} />
        <Text style={styles.headerText}>LEAD MAP</Text>
        <View style={{ flex: 1 }} />
        {onToggleLayer && (
          <View style={styles.toggleBar}>
            <TouchableOpacity
              style={[styles.toggle, layers.leads && styles.toggleOn]}
              onPress={() => onToggleLayer("leads")}
              testID="layer-toggle-leads"
            >
              <Feather name="map-pin" size={12} color={layers.leads ? "#fff" : colors.textInverseSecondary} />
              <Text style={[styles.toggleText, layers.leads && { color: "#fff" }]}>Leady ({validLeads.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggle, layers.reps && styles.toggleOn]}
              onPress={() => onToggleLayer("reps")}
              testID="layer-toggle-reps"
            >
              <Feather name="users" size={12} color={layers.reps ? "#fff" : colors.textInverseSecondary} />
              <Text style={[styles.toggleText, layers.reps && { color: "#fff" }]}>Handlowcy ({validReps.length})</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 8 }}>
        {layers.reps &&
          validReps.map((r) => {
            const active = selectedRepId === r.user_id;
            const dotColor = r.active ? colors.secondary : "#64748B";
            return (
              <TouchableOpacity
                key={`rep-${r.user_id}`}
                style={[styles.repRow, active && { borderColor: colors.secondary, backgroundColor: "#13294B" }]}
                onPress={() => onSelectRep?.(active ? null : r.user_id)}
                testID={`map-rep-${r.user_id}`}
                activeOpacity={0.8}
              >
                <View style={[styles.repAvatar, { borderColor: dotColor }]}>
                  <Text style={styles.repInitials}>{repInitials(r.name)}</Text>
                  <View style={[styles.onlineDot, { backgroundColor: dotColor }]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.repName} numberOfLines={1}>{r.name}</Text>
                  <Text style={styles.repMeta}>
                    {r.active ? formatWorkTime(r.last_seen_seconds) : `Offline · ${formatLastSeen(r.last_seen_seconds)}`}
                    {typeof r.battery === "number" && ` · 🔋 ${Math.round(r.battery * 100)}%`}
                  </Text>
                </View>
                <Text style={styles.repCoords}>{r.lat.toFixed(3)}, {r.lng.toFixed(3)}</Text>
              </TouchableOpacity>
            );
          })}

        {layers.leads &&
          validLeads.slice(0, 40).map((p) => {
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
                <Text style={styles.coords}>{p.lat!.toFixed(3)}, {p.lng!.toFixed(3)}</Text>
                <Text style={[styles.status, { color: c }]}>{statusLabel[p.status || ""] || p.status}</Text>
              </TouchableOpacity>
            );
          })}

        {(!layers.leads && !layers.reps) && (
          <Text style={{ color: colors.textInverseSecondary, textAlign: "center", marginTop: 20 }}>
            Włącz warstwę, aby zobaczyć pinezki.
          </Text>
        )}
        {layers.leads && layers.reps && validLeads.length === 0 && validReps.length === 0 && (
          <Text style={{ color: colors.textInverseSecondary, textAlign: "center", marginTop: 20 }}>
            Brak danych do wyświetlenia.
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
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderDark, flexWrap: "wrap" },
  headerText: { color: colors.textInverseSecondary, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  toggleBar: { flexDirection: "row", gap: 6 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#18181b", borderWidth: 1, borderColor: colors.borderDark },
  toggleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleText: { fontSize: 10, fontWeight: "800", color: colors.textInverseSecondary, letterSpacing: 0.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: "#18181b", borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderDark },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, color: colors.textInverse, fontSize: 13, fontWeight: "600" },
  coords: { color: colors.textInverseSecondary, fontSize: 11 },
  status: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  repRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, backgroundColor: "#0F1F3D", borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderDark },
  repAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", borderWidth: 2, position: "relative" },
  repInitials: { color: "#fff", fontWeight: "900", fontSize: 11 },
  onlineDot: { position: "absolute", bottom: -2, right: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.inverted },
  repName: { color: "#fff", fontWeight: "800", fontSize: 13 },
  repMeta: { color: colors.textInverseSecondary, fontSize: 10, marginTop: 2 },
  repCoords: { color: colors.textInverseSecondary, fontSize: 10 },
  hint: { color: colors.textInverseSecondary, fontSize: 10, textAlign: "center", padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderDark },
});
