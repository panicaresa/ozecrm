import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, radius, spacing, statusColor, statusLabel } from "../theme";

export interface Lead {
  id: string;
  client_name: string;
  status: string;
  address?: string;
  postal_code?: string;
  apartment_number?: string | null;
  phone?: string;
  latitude?: number;
  longitude?: number;
  building_area?: number;
  building_type?: string;
  created_at?: string;
  assigned_to?: string;
  note?: string;
  meeting_at?: string | null;
  nearby_override_confirmed?: boolean;
  nearby_override_other_lead_id?: string | null;
  nearby_override_distance_m?: number | null;
}

export const LeadCard: React.FC<{ lead: Lead; onPress?: () => void; testID?: string }> = ({ lead, onPress, testID }) => {
  const sc = statusColor[lead.status] || colors.textSecondary;
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7} testID={testID}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>{lead.client_name}</Text>
        <View style={[styles.badge, { backgroundColor: `${sc}22` }]}>
          <View style={[styles.dot, { backgroundColor: sc }]} />
          <Text style={[styles.badgeText, { color: sc }]}>{statusLabel[lead.status] || lead.status}</Text>
        </View>
      </View>
      {!!lead.address && (
        <View style={styles.row}>
          <Feather name="map-pin" size={12} color={colors.textSecondary} />
          <Text style={styles.rowText} numberOfLines={1}>{lead.address}</Text>
        </View>
      )}
      {!!lead.phone && (
        <View style={styles.row}>
          <Feather name="phone" size={12} color={colors.textSecondary} />
          <Text style={styles.rowText}>{lead.phone}</Text>
        </View>
      )}
      {!!lead.building_area && (
        <View style={styles.row}>
          <Feather name="home" size={12} color={colors.textSecondary} />
          <Text style={styles.rowText}>
            {lead.building_type === "gospodarczy" ? "Gospodarczy" : "Mieszkalny"} · {lead.building_area} m²
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.zinc100,
    gap: 6,
    // Sprint 4 cosmetic — modern box-shadow for web, elevation for Android
    boxShadow: "0px 2px 6px rgba(0,0,0,0.04)",
    elevation: 1,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, marginLeft: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowText: { fontSize: 13, color: colors.textSecondary, flex: 1 },
});
