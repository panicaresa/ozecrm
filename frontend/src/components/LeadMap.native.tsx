import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT, Callout, Polyline } from "react-native-maps";
import { Feather } from "@expo/vector-icons";
import { colors, radius, statusColor, statusLabel } from "../theme";

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
  tracks?: Record<string, { lat: number; lng: number; t?: string }[]>; // rep_id → polyline
  height?: number;
  testID?: string;
  selectedId?: string | null;
  onSelectPin?: (id: string | null) => void;
  layers?: LayerState;
  onToggleLayer?: (key: keyof LayerState) => void;
  onSelectRep?: (id: string | null) => void;
  selectedRepId?: string | null;
  // Sprint 5-pre-quad: opens RepActionSheet (call/profile/KPI) on rep marker tap.
  // Fires alongside onSelectRep — kept independent so existing read-only
  // callout behaviour stays untouched.
  onRepActionRequested?: (rep: RepPin) => void;
}

function repInitials(name?: string | null) {
  if (!name || typeof name !== "string") return "?";
  try {
    const parts = name.split(" ").filter(Boolean);
    if (parts.length === 0) return "?";
    return parts.map((p) => p?.[0] || "").join("").slice(0, 2).toUpperCase() || "?";
  } catch {
    return "?";
  }
}

function formatWorkTime(s?: number | null) {
  if (s == null) return "—";
  const h = Math.floor(s / 3600);
  if (h > 0) return `W terenie ${h}h`;
  const m = Math.floor(s / 60);
  return `Aktywny ${m}min`;
}

export const LeadMap: React.FC<Props> = ({
  pins,
  reps = [],
  tracks = {},
  height = 320,
  testID,
  onSelectPin,
  layers = { leads: true, reps: true },
  onToggleLayer,
  onSelectRep,
  selectedRepId,
  onRepActionRequested,
}) => {
  const safePins = Array.isArray(pins) ? pins : [];
  const safeReps = Array.isArray(reps) ? reps : [];
  const safeTracks = tracks && typeof tracks === "object" ? tracks : {};
  const validLeads = safePins.filter((p) => p && typeof p.lat === "number" && typeof p.lng === "number");
  const validReps = safeReps.filter((r) => r && typeof r.lat === "number" && typeof r.lng === "number" && r.user_id);
  const anchor = validLeads[0] || validReps[0];
  const center = anchor
    ? { latitude: (anchor as any).lat, longitude: (anchor as any).lng }
    : { latitude: 54.372, longitude: 18.638 };

  return (
    <View style={{ height, borderRadius: radius.lg, overflow: "hidden" }} testID={testID}>
      <MapView
        style={{ flex: 1 }}
        provider={PROVIDER_DEFAULT}
        initialRegion={{ ...center, latitudeDelta: 0.3, longitudeDelta: 0.3 }}
      >
        {layers.leads &&
          validLeads?.map((p) => (
            <Marker
              key={`lead-${p.id}`}
              coordinate={{ latitude: p.lat!, longitude: p.lng! }}
              title={p.client_name || ""}
              description={statusLabel[p.status || ""] || p.status}
              pinColor={statusColor[p.status || ""] || colors.primary}
              onPress={() => onSelectPin?.(p.id)}
            />
          ))}
        {layers.reps &&
          validReps?.map((r) => {
            const track = safeTracks?.[r.user_id];
            const validTrackPoints = Array.isArray(track)
              ? track.filter((p) => p && typeof p.lat === "number" && typeof p.lng === "number")
              : [];
            const hasTrack = validTrackPoints.length > 1;
            const isSelected = selectedRepId === r.user_id;
            const dotColor = r.active ? colors.secondary : "#64748B";
            return (
              <React.Fragment key={`rep-wrap-${r.user_id}`}>
                {hasTrack && (
                  <Polyline
                    key={`track-${r.user_id}`}
                    coordinates={validTrackPoints?.map((p) => ({ latitude: p.lat, longitude: p.lng })) || []}
                    strokeWidth={isSelected ? 5 : 3}
                    strokeColor={isSelected ? colors.primary : `${colors.secondary}CC`}
                    lineCap="round"
                    lineJoin="round"
                  />
                )}
                <Marker
                  key={`rep-${r.user_id}`}
                  coordinate={{ latitude: r.lat, longitude: r.lng }}
                  onPress={() => {
                    onSelectRep?.(r.user_id);
                    onRepActionRequested?.(r);
                  }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  zIndex={10}
                >
                  <View style={[styles.repBubble, { backgroundColor: dotColor, borderColor: isSelected ? colors.primary : "#fff", borderWidth: isSelected ? 4 : 3 }]}>
                    <Text style={styles.repInitials}>{repInitials(r.name)}</Text>
                  </View>
                  <Callout tooltip>
                    <View style={styles.callout}>
                      <Text style={styles.calloutName}>{r.name}</Text>
                      <Text style={styles.calloutMeta}>
                        {r.active ? formatWorkTime(r.last_seen_seconds) : "Offline"}
                      </Text>
                      {typeof r.battery === "number" && (
                        <Text style={styles.calloutMeta}>🔋 {Math.round(r.battery * 100)}%</Text>
                      )}
                      {hasTrack && <Text style={styles.calloutMeta}>📍 {validTrackPoints.length} punktów trasy</Text>}
                    </View>
                  </Callout>
                </Marker>
              </React.Fragment>
            );
          })}
      </MapView>

      {onToggleLayer && (
        <View style={styles.toggleOverlay}>
          <TouchableOpacity
            style={[styles.toggle, layers.leads && styles.toggleOn]}
            onPress={() => onToggleLayer("leads")}
            testID="layer-toggle-leads"
          >
            <Feather name="map-pin" size={12} color={layers.leads ? "#fff" : colors.textPrimary} />
            <Text style={[styles.toggleText, layers.leads && { color: "#fff" }]}>Leady ({validLeads.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggle, layers.reps && styles.toggleOn]}
            onPress={() => onToggleLayer("reps")}
            testID="layer-toggle-reps"
          >
            <Feather name="users" size={12} color={layers.reps ? "#fff" : colors.textPrimary} />
            <Text style={[styles.toggleText, layers.reps && { color: "#fff" }]}>Handlowcy ({validReps.length})</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  repBubble: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 3 },
  repInitials: { color: "#fff", fontWeight: "900", fontSize: 11 },
  callout: { backgroundColor: colors.inverted, padding: 10, borderRadius: 8, minWidth: 140 },
  calloutName: { color: "#fff", fontWeight: "900", fontSize: 13 },
  calloutMeta: { color: colors.textInverseSecondary, fontSize: 11, marginTop: 2 },
  toggleOverlay: { position: "absolute", top: 10, left: 10, right: 10, flexDirection: "row", gap: 6 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.92)", borderWidth: 1, borderColor: colors.border },
  toggleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleText: { fontSize: 10, fontWeight: "800", color: colors.textPrimary, letterSpacing: 0.5 },
});
