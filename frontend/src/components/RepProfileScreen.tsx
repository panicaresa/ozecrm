// Sprint 3.5c micro: shared rep profile screen
// Used by:
//   - /app/frontend/app/(manager)/rep/[id].tsx  (scope="manager")
//   - /app/frontend/app/(admin)/rep/[id].tsx    (scope="admin")
//
// Behavioural differences per scope:
//   - "admin":   shows breadcrumb "Cała firma → <manager_name> → <rep_name>"
//                + an extra "Manager:" row so admin knows who reports where.
//   - "manager": shows only the rep's name in the header (existing behaviour).
//
// Everything else (KPIs, map, session stats, overrides, leads list) is 100%
// identical — we just centralised the implementation.
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, radius, spacing, statusColor, statusLabel } from "../theme";
import { api, formatApiError } from "../lib/api";
import { fmtDuration, fmtDistanceKm } from "../lib/useWorkStatus";
import { fmtPln } from "../lib/offerEngine";
import { LeadMap } from "./LeadMap";

interface OverrideEntry {
  lead_id: string;
  lead_client_name?: string | null;
  other_lead_client_name?: string | null;
  distance_m?: number | null;
  created_at?: string | null;
}

interface Profile {
  user: {
    id: string;
    name?: string;
    email: string;
    role: string;
    manager_id?: string;
  };
  kpi: {
    total_leads: number;
    signed_count: number;
    meeting_count: number;
    session_seconds: number;
    session_distance_m: number;
    is_working: boolean;
    commission_payable: number;
    commission_frozen: number;
    contracts_count: number;
  };
  status_breakdown: Record<string, number>;
  leads: any[];
  track: { lat: number; lng: number; t?: string }[];
  override_stats?: {
    total: number;
    this_month: number;
    recent_overrides: OverrideEntry[];
  };
}

interface LiteUser {
  id: string;
  name?: string;
  email: string;
}

interface Props {
  scope: "admin" | "manager";
}

export default function RepProfileScreen({ scope }: Props) {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [data, setData] = useState<Profile | null>(null);
  const [managerInfo, setManagerInfo] = useState<LiteUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await api.get<Profile>(`/users/${id}/profile`);
      setData(res.data);
      // Admin-only: fetch the rep's manager for the breadcrumb.
      if (scope === "admin" && res.data.user.manager_id) {
        try {
          const all = await api.get<LiteUser[]>("/users");
          const m = (all.data || []).find(
            (u) => u.id === res.data.user.manager_id
          );
          if (m) setManagerInfo(m);
          else setManagerInfo(null);
        } catch {
          setManagerInfo(null);
        }
      } else {
        setManagerInfo(null);
      }
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, scope]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (err || !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.err}>{err || "Nie znaleziono użytkownika"}</Text>
      </SafeAreaView>
    );
  }

  const initials =
    (data.user.name || data.user.email)
      .split(" ")
      .filter(Boolean)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  const pins = (data.leads || [])
    .filter(
      (l) => typeof l.latitude === "number" && typeof l.longitude === "number"
    )
    .map((l) => ({
      id: l.id,
      lat: l.latitude,
      lng: l.longitude,
      status: l.status,
      client_name: l.client_name,
    }));

  const lastLoc =
    data.track && data.track.length > 0
      ? data.track[data.track.length - 1]
      : null;
  const repPin = lastLoc
    ? [
        {
          user_id: data.user.id,
          name: data.user.name || data.user.email,
          lat: lastLoc.lat,
          lng: lastLoc.lng,
          active: data.kpi.is_working,
          last_seen_seconds: 0,
        },
      ]
    : [];

  // Admin-only breadcrumb string
  const breadcrumb =
    scope === "admin"
      ? `Cała firma${
          managerInfo
            ? ` · Manager: ${managerInfo.name || managerInfo.email}`
            : ""
        }`
      : null;

  return (
    <SafeAreaView
      style={styles.safe}
      edges={["top", "bottom"]}
      testID="rep-profile-screen"
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.back}
          onPress={() => router.back()}
          testID="rep-back"
        >
          <Feather name="arrow-left" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          {breadcrumb && (
            <Text style={styles.breadcrumb} numberOfLines={1} testID="rep-breadcrumb">
              {breadcrumb}
            </Text>
          )}
          <Text style={styles.title}>{data.user.name || data.user.email}</Text>
          <Text style={styles.subtitle}>{data.user.email}</Text>
        </View>
        {scope === "admin" && (
          <View style={styles.scopeChip} testID="scope-badge-admin">
            <Feather name="shield" size={10} color={colors.primary} />
            <Text style={styles.scopeChipText}>ADMIN</Text>
          </View>
        )}
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
      >
        {/* Admin-only manager info row (before the profile hero) */}
        {scope === "admin" && managerInfo && (
          <TouchableOpacity
            style={styles.managerInfoCard}
            onPress={() =>
              router.push(`/(admin)/rep/${managerInfo.id}` as never)
            }
            activeOpacity={0.8}
            testID="admin-manager-info"
          >
            <View style={styles.managerInfoIcon}>
              <Feather name="briefcase" size={14} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.managerInfoLabel}>Manager</Text>
              <Text style={styles.managerInfoName} numberOfLines={1}>
                {managerInfo.name || managerInfo.email}
              </Text>
            </View>
            <Feather
              name="chevron-right"
              size={16}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        )}

        {/* Profile hero card */}
        <View style={styles.heroCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: data.kpi.is_working
                    ? colors.secondary
                    : "#94A3B8",
                },
              ]}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroName}>{data.user.name || "—"}</Text>
            <Text style={styles.heroEmail}>{data.user.email}</Text>
            <View style={styles.badgesRow}>
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: data.kpi.is_working
                      ? `${colors.secondary}20`
                      : "#F1F5F9",
                  },
                ]}
              >
                <View
                  style={[
                    styles.badgeDot,
                    {
                      backgroundColor: data.kpi.is_working
                        ? colors.secondary
                        : "#94A3B8",
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.badgeText,
                    {
                      color: data.kpi.is_working
                        ? colors.secondary
                        : colors.textSecondary,
                    },
                  ]}
                >
                  {data.kpi.is_working ? "W TERENIE" : "Offline"}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Session stats if active */}
        {data.kpi.is_working && (
          <View style={styles.sessionCard}>
            <Text style={styles.sectionLabel}>Dzisiejsza sesja</Text>
            <View style={styles.sessionRow}>
              <View style={styles.sessionItem}>
                <Feather name="clock" size={16} color={colors.secondary} />
                <Text style={styles.sessionValue}>
                  {fmtDuration(data.kpi.session_seconds)}
                </Text>
                <Text style={styles.sessionLabel}>czas pracy</Text>
              </View>
              <View style={styles.sessionSep} />
              <View style={styles.sessionItem}>
                <Feather name="navigation" size={16} color={colors.secondary} />
                <Text style={styles.sessionValue}>
                  {fmtDistanceKm(data.kpi.session_distance_m)}
                </Text>
                <Text style={styles.sessionLabel}>przebyto</Text>
              </View>
            </View>
          </View>
        )}

        {/* KPI Grid */}
        <View style={styles.kpiGrid}>
          <View style={[styles.kpi, { borderLeftColor: colors.primary }]}>
            <Text style={styles.kpiLabel}>Leady</Text>
            <Text style={styles.kpiValue}>{data.kpi.total_leads}</Text>
          </View>
          <View style={[styles.kpi, { borderLeftColor: colors.secondary }]}>
            <Text style={styles.kpiLabel}>Podpisane</Text>
            <Text style={styles.kpiValue}>{data.kpi.signed_count}</Text>
          </View>
          <View style={[styles.kpi, { borderLeftColor: colors.accent }]}>
            <Text style={styles.kpiLabel}>Spotkania</Text>
            <Text style={styles.kpiValue}>{data.kpi.meeting_count}</Text>
          </View>
          <View style={[styles.kpi, { borderLeftColor: colors.info }]}>
            <Text style={styles.kpiLabel}>Umowy</Text>
            <Text style={styles.kpiValue}>{data.kpi.contracts_count}</Text>
          </View>
        </View>

        {/* Commission */}
        <View style={styles.commissionCard}>
          <Text style={styles.sectionLabel}>Prowizje</Text>
          <View style={styles.commissionRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.commissionLabel}>Do wypłaty</Text>
              <Text
                style={[styles.commissionValue, { color: colors.secondary }]}
              >
                {fmtPln(data.kpi.commission_payable)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.commissionLabel}>Zamrożone (14d)</Text>
              <Text style={[styles.commissionValue, { color: colors.info }]}>
                {fmtPln(data.kpi.commission_frozen)}
              </Text>
            </View>
          </View>
        </View>

        {/* Mini-map with track */}
        {(pins.length > 0 || repPin.length > 0) && (
          <View style={styles.mapCard}>
            <Text style={styles.sectionLabel}>
              Mapa (leady + trasa dzisiejsza)
            </Text>
            <LeadMap
              pins={pins}
              reps={repPin}
              tracks={lastLoc ? { [data.user.id]: data.track } : {}}
              height={260}
              layers={{ leads: true, reps: true }}
            />
          </View>
        )}

        {/* Sprint 1 — Override'y anti-collision (widoczne tylko gdy total>0) */}
        {!!data.override_stats && data.override_stats.total > 0 && (
          <View style={styles.overrideCard} testID="override-stats-section">
            <Text style={styles.sectionLabel}>Override'y anti-collision</Text>
            <View style={styles.overrideTopRow}>
              <View style={styles.overrideStat}>
                <Text style={styles.overrideStatValue}>
                  {data.override_stats.this_month}
                </Text>
                <Text style={styles.overrideStatLabel}>w tym miesiącu</Text>
              </View>
              <View style={styles.overrideDivider} />
              <View style={styles.overrideStat}>
                <Text style={styles.overrideStatValue}>
                  {data.override_stats.total}
                </Text>
                <Text style={styles.overrideStatLabel}>łącznie</Text>
              </View>
            </View>
            {data.override_stats.recent_overrides.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.overrideSubHeader}>Ostatnie:</Text>
                {data.override_stats.recent_overrides.map((o) => {
                  const ago = (() => {
                    if (!o.created_at) return "";
                    try {
                      const d = new Date(o.created_at);
                      const days = Math.max(
                        0,
                        Math.round((Date.now() - d.getTime()) / 86400000)
                      );
                      if (days === 0) return "dziś";
                      if (days === 1) return "wczoraj";
                      return `${days} dni temu`;
                    } catch {
                      return "";
                    }
                  })();
                  return (
                    <TouchableOpacity
                      key={o.lead_id}
                      style={styles.overrideRow}
                      onPress={() =>
                        router.push(`/(manager)/lead/${o.lead_id}` as never)
                      }
                      testID={`override-entry-${o.lead_id}`}
                      activeOpacity={0.7}
                    >
                      <Feather
                        name="alert-circle"
                        size={14}
                        color="#EA580C"
                      />
                      <Text style={styles.overrideRowText} numberOfLines={2}>
                        <Text style={{ fontWeight: "800" }}>
                          {o.lead_client_name || "—"}
                        </Text>
                        {o.distance_m != null
                          ? ` (${Math.round(o.distance_m)} m`
                          : " ("}
                        {o.other_lead_client_name
                          ? ` od ${o.other_lead_client_name}`
                          : ""}
                        {ago ? `, ${ago})` : ")"}
                      </Text>
                      <Feather
                        name="chevron-right"
                        size={14}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <Text style={styles.overrideHint}>
              💡 Override'y pokazują przypadki gdzie system ostrzegł o bliskim
              istniejącym leadzie, ale handlowiec potwierdził że to inny
              klient.
            </Text>
          </View>
        )}

        {/* Status breakdown */}
        <View style={styles.statusCard}>
          <Text style={styles.sectionLabel}>Lejek statusów</Text>
          <View style={{ gap: 8 }}>
            {Object.entries(data.status_breakdown || {}).map(([s, n]) => (
              <View key={s} style={styles.statusRow}>
                <View
                  style={[
                    styles.statusDotSm,
                    { backgroundColor: statusColor[s] || "#94A3B8" },
                  ]}
                />
                <Text style={styles.statusName}>{statusLabel[s] || s}</Text>
                <Text style={styles.statusCount}>{n}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Leads list */}
        <View style={styles.leadsCard}>
          <Text style={styles.sectionLabel}>Leady ({data.leads.length})</Text>
          {data.leads.length === 0 ? (
            <Text style={styles.empty}>Handlowiec nie ma jeszcze leadów.</Text>
          ) : (
            data.leads.map((l) => (
              <TouchableOpacity
                key={l.id}
                style={styles.leadRow}
                onPress={() =>
                  router.push(`/(manager)/lead/${l.id}` as never)
                }
                testID={`rep-profile-lead-${l.id}`}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.statusDotSm,
                    { backgroundColor: statusColor[l.status] || "#94A3B8" },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.leadName}>{l.client_name || "—"}</Text>
                  <Text style={styles.leadSub} numberOfLines={1}>
                    {l.address || "brak adresu"} ·{" "}
                    {statusLabel[l.status] || l.status}
                  </Text>
                </View>
                <Feather
                  name="chevron-right"
                  size={16}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  breadcrumb: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: "800",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary },
  scopeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: `${colors.primary}15`,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
  },
  scopeChipText: {
    fontSize: 9,
    fontWeight: "900",
    color: colors.primary,
    letterSpacing: 1,
  },
  managerInfoCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: `${colors.primary}30`,
  },
  managerInfoIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: `${colors.primary}15`,
  },
  managerInfoLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  managerInfoName: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "800",
    marginTop: 1,
  },
  heroCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarText: { color: "#fff", fontWeight: "900", fontSize: 18 },
  statusDot: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.paper,
  },
  heroName: { fontSize: 17, fontWeight: "900", color: colors.textPrimary },
  heroEmail: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  badgesRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  sessionCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  sessionItem: { alignItems: "center", gap: 4, flex: 1 },
  sessionValue: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  sessionLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sessionSep: { width: 1, height: 36, backgroundColor: colors.border },
  kpiGrid: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 12,
  },
  kpi: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: colors.paper,
    padding: 14,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kpiLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: "900",
    color: colors.textPrimary,
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },
  commissionCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  commissionRow: { flexDirection: "row", gap: 12 },
  commissionLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: "700" },
  commissionValue: {
    fontSize: 18,
    fontWeight: "900",
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },
  mapCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusDotSm: { width: 10, height: 10, borderRadius: 5 },
  statusName: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  statusCount: { fontSize: 14, fontWeight: "900", color: colors.textPrimary },
  leadsCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  leadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc100,
  },
  overrideCard: {
    backgroundColor: "#FFFBEB",
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#FCD34D",
  },
  overrideTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  overrideStat: { flex: 1, alignItems: "center" },
  overrideStatValue: { fontSize: 22, fontWeight: "900", color: "#92400E" },
  overrideStatLabel: {
    fontSize: 11,
    color: "#78350F",
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  overrideDivider: { width: 1, height: 30, backgroundColor: "#FCD34D" },
  overrideSubHeader: {
    fontSize: 12,
    fontWeight: "800",
    color: "#78350F",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  overrideRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#FDE68A",
  },
  overrideRowText: { flex: 1, fontSize: 12, color: "#78350F" },
  overrideHint: {
    marginTop: 10,
    fontSize: 11,
    color: "#92400E",
    lineHeight: 16,
    fontStyle: "italic",
  },
  leadName: { fontSize: 13, fontWeight: "800", color: colors.textPrimary },
  leadSub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  empty: {
    color: colors.textSecondary,
    textAlign: "center",
    padding: 12,
    fontSize: 13,
  },
  err: { color: colors.error, padding: spacing.md, fontSize: 14 },
});
