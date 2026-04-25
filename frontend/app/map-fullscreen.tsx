// Sprint 5-pre-bis (ISSUE-UX-002) — Full-screen map view.
// Reachable from manager/admin dashboards via `router.push("/map-fullscreen")`.
// Reuses the same LeadMap component the dashboards embed, just hands it a
// large height and full container. Refetches /api/dashboard/manager + /api/leads
// independently so the screen works even if the user deep-links to it.
//
// Auth: any authenticated user with a token (server still RBACs the data —
// /api/dashboard/manager is admin+manager only). If a handlowiec ever lands
// here we redirect them back to their dashboard.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import { colors, radius, spacing, statusColor, statusLabel } from "../src/theme";
import { api, formatApiError } from "../src/lib/api";
import { useAuth } from "../src/lib/auth";
import { LeadMap } from "../src/components/LeadMap";
import { useRepLocationsWS } from "../src/lib/useRepLocationsWS";
import type { Lead } from "../src/components/LeadCard";

interface DashboardData {
  pins: any[];
  reps_live: any[];
}

export default function MapFullscreen() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ filter_status?: string; rep_id?: string }>();
  const initialStatus = typeof params.filter_status === "string" ? params.filter_status : null;
  const initialRepId = typeof params.rep_id === "string" ? params.rep_id : null;

  const [data, setData] = useState<DashboardData | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(initialStatus);
  const [filterRepId, setFilterRepId] = useState<string | null>(initialRepId);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
  const [layers, setLayers] = useState({ leads: true, reps: true });

  // Live WS updates (reuses the same hook the dashboard uses)
  const ws = useRepLocationsWS(true);
  const wsLocations = ws?.locations ?? new Map();

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [dashRes, leadsRes] = await Promise.all([
        api.get<DashboardData>("/dashboard/manager"),
        api.get<Lead[]>("/leads"),
      ]);
      setData(dashRes.data);
      setLeads(leadsRes.data);
    } catch (e: any) {
      setErr(formatApiError(e, "Nie udało się pobrać danych mapy"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    if (user.role === "handlowiec") {
      // Handlowiec doesn't have access to /api/dashboard/manager; bounce.
      router.replace("/(rep)" as any);
      return;
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [user, load, router]);

  const mergedReps = useMemo(() => {
    try {
      const base = Array.isArray(data?.reps_live) ? (data!.reps_live as any[]) : [];
      if (!wsLocations || wsLocations.size === 0) return base;
      const result = base.map((r: any) => {
        if (!r || !r.user_id) return r;
        const live = wsLocations.get(r.user_id);
        if (!live) return r;
        return {
          ...r,
          lat: typeof live.latitude === "number" ? live.latitude : r.lat,
          lng: typeof live.longitude === "number" ? live.longitude : r.lng,
          battery: live.battery ?? r.battery,
          active: live.is_active ?? r.active,
        };
      });
      const entries = Array.from(wsLocations.entries?.() ?? []);
      for (const [rid, live] of entries) {
        if (!rid || !live) continue;
        if (typeof live.latitude !== "number" || typeof live.longitude !== "number") continue;
        if (!result.find((r: any) => r?.user_id === rid)) {
          result.push({
            user_id: rid,
            name: live.rep_name || "—",
            lat: live.latitude,
            lng: live.longitude,
            battery: live.battery,
            active: live.is_active,
            last_seen_seconds: 0,
          });
        }
      }
      return result;
    } catch {
      return Array.isArray(data?.reps_live) ? (data!.reps_live as any[]) : [];
    }
  }, [data?.reps_live, wsLocations]);

  const tracks = useMemo(() => {
    try {
      const t: Record<string, { lat: number; lng: number; t?: string }[]> = {};
      const entries = Array.from(wsLocations?.entries?.() ?? []);
      for (const [rid, live] of entries) {
        if (!rid || !live?.track || !Array.isArray(live.track)) continue;
        const clean = live.track.filter(
          (p: any) => p && typeof p.lat === "number" && typeof p.lng === "number"
        );
        if (clean.length > 0) t[rid] = clean;
      }
      return t;
    } catch {
      return {};
    }
  }, [wsLocations]);

  const filteredPins = useMemo(() => {
    const allPins = data?.pins || [];
    if (!filterStatus && !filterRepId) return allPins;
    return allPins.filter((p: any) => {
      if (filterStatus && p.status !== filterStatus) return false;
      if (filterRepId) {
        const lead = leads.find((l) => l.id === p.id);
        if (!lead || lead.assigned_to !== filterRepId) return false;
      }
      return true;
    });
  }, [data?.pins, filterStatus, filterRepId, leads]);

  // Sprint 5-pre-bis (ISSUE-UX-002 v2): map gets ALL remaining vertical space
  // after the header (~56) and the chips strip (~56). Subtract safe-area
  // insets for proper rendering on devices with home indicator / notch.
  // 56 (header) + 56 (chips) = 112; the rest goes to the map.
  const HEADER_H = 56;
  const CHIPS_H = 56;
  const mapHeight = Math.max(
    320,
    Dimensions.get("window").height - HEADER_H - CHIPS_H - insets.top - insets.bottom
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            testID="map-back"
            accessibilityLabel="Wróć"
          >
            <Feather name="arrow-left" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Mapa leadów · pełny ekran</Text>
            {data && (
              <Text style={styles.subtitle}>
                {(data.pins || []).length} leadów · {(data.reps_live || []).length} handlowców
              </Text>
            )}
          </View>
          <TouchableOpacity
            onPress={load}
            style={styles.backBtn}
            testID="map-refresh"
            accessibilityLabel="Odśwież"
          >
            <Feather name="refresh-cw" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Status filter chips — same set the dashboard exposes.
            Sprint 5-pre-bis-tris (ISSUE styling fix): wrapped in a
            fixed-height (56) View so the horizontal ScrollView doesn't
            inherit `flex: 1` from its parent and balloon out to half the
            screen as it did in the first build. */}
        {!loading && data && (
          <View style={styles.statusFilterWrapper}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.statusFilterRow}
              testID="map-fs-status-chips"
            >
              <TouchableOpacity
                onPress={() => {
                  setFilterStatus(null);
                  setSelectedPinId(null);
                }}
                style={[styles.statusChip, !filterStatus && styles.statusChipActive]}
                activeOpacity={0.85}
                testID="map-fs-chip-all"
              >
                <Text style={[styles.statusChipText, !filterStatus && { color: "#fff" }]}>
                  Wszystkie ({(data?.pins || []).length})
                </Text>
              </TouchableOpacity>
              {(["nowy", "umowione", "decyzja", "podpisana", "nie_zainteresowany"] as const).map(
                (s) => {
                  const count = (data?.pins || []).filter((p: any) => p.status === s).length;
                  const active = filterStatus === s;
                  const sc = statusColor[s] || colors.textSecondary;
                  return (
                    <TouchableOpacity
                      key={s}
                      onPress={() => {
                        setFilterStatus(active ? null : s);
                        setSelectedPinId(null);
                      }}
                      style={[
                        styles.statusChip,
                        active && { backgroundColor: sc, borderColor: sc },
                      ]}
                      activeOpacity={0.85}
                      testID={`map-fs-chip-${s}`}
                    >
                      <View
                        style={[
                          styles.statusChipDot,
                          { backgroundColor: active ? "#fff" : sc },
                        ]}
                      />
                      <Text
                        style={[styles.statusChipText, active && { color: "#fff" }]}
                      >
                        {statusLabel[s]} ({count})
                      </Text>
                    </TouchableOpacity>
                  );
                }
              )}
            </ScrollView>
          </View>
        )}

        {/* Body — single map block that fills ALL remaining vertical space.
            Sprint 5-pre-bis-tris fix: dropped the outer ScrollView wrapper
            (was forcing the map into ~40% of the viewport on web/iOS); the
            map's own internal ScrollView already handles list overflow. */}
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Wczytywanie mapy...</Text>
          </View>
        ) : err ? (
          <View style={styles.centered}>
            <Feather name="alert-triangle" size={28} color={colors.error} />
            <Text style={styles.errText}>{err}</Text>
            <TouchableOpacity onPress={load} style={styles.retryBtn} testID="map-retry">
              <Text style={styles.retryText}>Spróbuj ponownie</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.mapContainer}>
            <LeadMap
              pins={filteredPins || []}
              reps={mergedReps || []}
              tracks={tracks || {}}
              layers={layers}
              onToggleLayer={(k) => setLayers((s) => ({ ...s, [k]: !s[k] }))}
              selectedId={selectedPinId || null}
              selectedRepId={selectedRepId || null}
              onSelectPin={(id) => {
                setSelectedPinId(id);
                setSelectedRepId(null);
              }}
              onSelectRep={(id) => {
                setSelectedRepId(id);
                setSelectedPinId(null);
              }}
              height={mapHeight}
              testID="map-fullscreen-leadmap"
            />
          </View>
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.paper,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  title: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    fontWeight: "600",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: spacing.lg,
  },
  loadingText: { color: colors.textSecondary, fontSize: 13 },
  errText: { color: colors.error, fontSize: 13, textAlign: "center", marginTop: 4 },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  retryText: { color: "#fff", fontWeight: "800" },
  statusFilterRow: {
    paddingHorizontal: spacing.md,
    gap: 6,
    alignItems: "center", // chips vertically centered inside the 56px strip
  },
  // Sprint 5-pre-bis-tris fix: fixed-height host so the horizontal
  // ScrollView doesn't inherit `flex: 1` and balloon to half the viewport.
  statusFilterWrapper: {
    height: 56,
    flexShrink: 0,
    backgroundColor: colors.paper,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    justifyContent: "center",
  },
  // Sprint 5-pre-bis-tris fix: takes ALL remaining vertical space after
  // the header (56) and the chips strip (56). LeadMap reads `height` prop
  // for its minHeight; we feed it `mapHeight` derived from
  // window.height - 112 - safe-area insets.
  mapContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    height: 36, // fixed pill height — RN flex doesn't auto-shrink without this
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 0, // height handles vertical sizing
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.paper,
  },
  statusChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  statusChipDot: { width: 8, height: 8, borderRadius: 4 },
  statusChipText: { fontSize: 12, fontWeight: "700", color: colors.textPrimary },
});
