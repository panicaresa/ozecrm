import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, radius, spacing, statusColor, statusLabel } from "../../src/theme";
import { api, formatApiError } from "../../src/lib/api";
import { useAuth } from "../../src/lib/auth";
import { KpiTile } from "../../src/components/KpiTile";
import { ProgressRow } from "../../src/components/ProgressRow";
import { StatusDonut } from "../../src/components/StatusDonut";
import { LeadMap } from "../../src/components/LeadMap";
import { BrandLogo } from "../../src/components/BrandLogo";
import { QueueBadge } from "../../src/components/QueueBadge";
import { CommissionCalculator } from "../../src/components/CommissionCalculator";
import { DailyReportWidget } from "../../src/components/DailyReportWidget";
import { useRepLocationsWS } from "../../src/lib/useRepLocationsWS";
import {
  useRepActivity,
  getActivityColor,
  getActivityLabel,
} from "../../src/lib/useRepActivity";
import { Lead } from "../../src/components/LeadCard";

interface Dashboard {
  kpi: { meetings: number; new_leads: number; quotes: number; active_reps: number };
  status_breakdown: Record<string, number>;
  rep_progress: any[];
  top3: any[];
  pins: any[];
  reps_live: any[];
  total_leads: number;
}

export default function ManagerDashboard() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterRepId, setFilterRepId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
  // Sprint 5-pre-bis (ISSUE-UX-004): show first 5 reps in "Cele i postęp"
  // by default; user taps "Pokaż wszystkich (N)" to inline-expand.
  const [progressExpanded, setProgressExpanded] = useState(false);
  // Sprint 4 — poll rep activity every 60s; data is keyed by rep_id.
  const { data: activityData } = useRepActivity(true, 60_000);
  const activityByRepId = React.useMemo(() => {
    const m = new Map<string, (typeof activityData)[number]>();
    activityData.forEach((a) => m.set(a.rep_id, a));
    return m;
  }, [activityData]);
  const [layers, setLayers] = useState({ leads: true, reps: true });
  // Faza 2.0: Live WebSocket feed for reps (supplements the 30s polling)
  const ws = useRepLocationsWS(true);
  const wsStatus = ws?.status ?? { connected: false, error: null, reconnectAttempt: 0 };
  const wsLocations = ws?.locations ?? new Map();

  // Merge WS locations into reps_live (WS is more up-to-date than polling)
  const mergedReps = React.useMemo(() => {
    try {
      const base = Array.isArray(data?.reps_live) ? (data!.reps_live as any[]) : [];
      if (!wsLocations || wsLocations.size === 0) return base;
      const result = base.map((r) => {
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
      // Add any WS-only reps not in base (newly-online)
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

  // Track polylines from WS snapshot — defensive filtering of invalid points
  const tracks = React.useMemo(() => {
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

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [dashRes, leadsRes] = await Promise.all([
        api.get<Dashboard>("/dashboard/manager"),
        api.get<Lead[]>("/leads"),
      ]);
      setData(dashRes.data);
      setLeads(leadsRes.data);
    } catch (e: any) {
      setErr(formatApiError(e, "Nie udało się pobrać danych"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // refresh dashboard every 30s (live reps)
    return () => clearInterval(interval);
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const drilldownLeads = useMemo(() => {
    if (selectedPinId) return leads.filter((l) => l.id === selectedPinId);
    if (filterStatus || filterRepId || searchTerm) {
      const q = searchTerm.trim().toLowerCase();
      return leads.filter((l) => {
        if (filterStatus && l.status !== filterStatus) return false;
        if (filterRepId && l.assigned_to !== filterRepId) return false;
        if (q) {
          const haystack = [l.client_name, l.phone, l.address].filter(Boolean).join(" ").toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });
    }
    return [];
  }, [leads, filterStatus, filterRepId, searchTerm, selectedPinId]);

  // Filter map pins by status / rep / search
  const filteredPins = useMemo(() => {
    const allPins = data?.pins || [];
    const q = searchTerm.trim().toLowerCase();
    if (!filterStatus && !filterRepId && !q) return allPins;
    return allPins.filter((p: any) => {
      if (filterStatus && p.status !== filterStatus) return false;
      // Match rep filter via leads lookup
      if (filterRepId) {
        const lead = leads.find((l) => l.id === p.id);
        if (!lead || lead.assigned_to !== filterRepId) return false;
      }
      if (q) {
        const lead = leads.find((l) => l.id === p.id);
        const haystack = [p.client_name, lead?.phone, lead?.address].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [data?.pins, filterStatus, filterRepId, searchTerm, leads]);

  const drilldownTitle = selectedPinId
    ? "Wybrany lead"
    : filterStatus
    ? `Status: ${statusLabel[filterStatus]}`
    : "";

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
        testID="manager-dashboard-scroll"
      >
        {/* Top bar with logo */}
        <View style={styles.topbar}>
          <BrandLogo height={28} testID="manager-brand-logo" />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <QueueBadge />
            <TouchableOpacity style={styles.iconBtn} onPress={handleLogout} testID="logout-button">
              <Feather name="log-out" size={18} color={colors.textInverse} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Greeting */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Witaj, {user?.name?.split(" ")[0] || "Managerze"}</Text>
            <Text style={styles.today}>
              {new Date().toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })}
            </Text>
          </View>
        </View>

        <View style={styles.commandBar}>
          <Feather name="radio" size={12} color={colors.primary} />
          <Text style={styles.commandText}>CENTRUM DOWODZENIA</Text>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>

        {err && (
          <View style={styles.errBox}><Text style={styles.errText}>{err}</Text></View>
        )}

        <View style={styles.kpiGrid}>
          <KpiTile label="Spotkania" value={data?.kpi.meetings ?? 0} icon="calendar" accent={colors.accent} testID="kpi-meetings" />
          <KpiTile label="Nowe leady" value={data?.kpi.new_leads ?? 0} icon="user-plus" accent={colors.secondary} testID="kpi-new-leads" />
        </View>
        <View style={styles.kpiGrid}>
          <KpiTile label="Wyceny" value={data?.kpi.quotes ?? 0} icon="file-text" accent={colors.primary} testID="kpi-quotes" />
          <KpiTile label="Aktywni w terenie" value={data?.kpi.active_reps ?? 0} icon="users" accent={colors.info} testID="kpi-active-reps" />
        </View>

        {/* Sprint 5-pre-bis (ISSUE-UX-005) — Lead Map promoted to TOP of the
            dashboard (most operationally important). Maximize button opens
            the dedicated /map-fullscreen route. */}
        <View style={[styles.sectionCard, { padding: 0, overflow: "hidden" }]}>
          <View style={[styles.sectionHead, { padding: spacing.md, paddingBottom: 8 }]}>
            <Text style={styles.sectionTitle}>Lead Map · Live</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={styles.sectionSub}>
                {(data?.pins || []).length} · {(data?.reps_live || []).length}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: "/map-fullscreen",
                    params: filterStatus ? { filter_status: filterStatus } : undefined,
                  } as any)
                }
                style={styles.expandIconBtn}
                testID="map-expand"
                accessibilityLabel="Pełny ekran mapy"
                hitSlop={6}
              >
                <Feather name="maximize-2" size={16} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Sprint 4 — status filter chips (filters map + drilldown via filterStatus) */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.statusFilterRow}
            testID="status-filter-chips"
          >
            <TouchableOpacity
              onPress={() => { setFilterStatus(null); setSelectedPinId(null); }}
              style={[styles.statusChip, !filterStatus && styles.statusChipActive]}
              activeOpacity={0.85}
              testID="status-chip-all"
            >
              <Text
                style={[
                  styles.statusChipText,
                  !filterStatus && { color: "#fff" },
                ]}
              >
                Wszystkie ({(data?.pins || []).length})
              </Text>
            </TouchableOpacity>
            {(["nowy", "umowione", "decyzja", "podpisana", "nie_zainteresowany"] as const).map((s) => {
              const count = (data?.pins || []).filter((p: any) => p.status === s).length;
              const active = filterStatus === s;
              const sc = statusColor[s] || colors.textSecondary;
              return (
                <TouchableOpacity
                  key={s}
                  onPress={() => { setFilterStatus(active ? null : s); setSelectedPinId(null); }}
                  style={[
                    styles.statusChip,
                    active && { backgroundColor: sc, borderColor: sc },
                  ]}
                  activeOpacity={0.85}
                  testID={`status-chip-${s}`}
                >
                  <View
                    style={[
                      styles.statusChipDot,
                      { backgroundColor: active ? "#fff" : sc },
                    ]}
                  />
                  <Text
                    style={[
                      styles.statusChipText,
                      active && { color: "#fff" },
                    ]}
                  >
                    {statusLabel[s]} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Prominent layer toggles ABOVE the map — clearly visible */}
          <View style={styles.layerBar}>
            <TouchableOpacity
              style={[styles.layerToggle, layers.leads && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              onPress={() => setLayers((l) => ({ ...l, leads: !l.leads }))}
              activeOpacity={0.8}
              testID="layer-toggle-leads"
            >
              <View style={[styles.layerCheckbox, layers.leads && { backgroundColor: "#fff", borderColor: "#fff" }]}>
                {layers.leads && <Feather name="check" size={12} color={colors.primary} />}
              </View>
              <Feather name="map-pin" size={14} color={layers.leads ? "#fff" : colors.textPrimary} />
              <Text style={[styles.layerText, layers.leads && { color: "#fff" }]}>
                Pokaż Leady ({(data?.pins || []).length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.layerToggle, layers.reps && { backgroundColor: colors.secondary, borderColor: colors.secondary }]}
              onPress={() => setLayers((l) => ({ ...l, reps: !l.reps }))}
              activeOpacity={0.8}
              testID="layer-toggle-reps"
            >
              <View style={[styles.layerCheckbox, layers.reps && { backgroundColor: "#fff", borderColor: "#fff" }]}>
                {layers.reps && <Feather name="check" size={12} color={colors.secondary} />}
              </View>
              <Feather name="users" size={14} color={layers.reps ? "#fff" : colors.textPrimary} />
              <Text style={[styles.layerText, layers.reps && { color: "#fff" }]}>
                Pokaż Handlowców ({(data?.reps_live || []).length})
              </Text>
            </TouchableOpacity>
          </View>

          <LeadMap
            pins={filteredPins || []}
            reps={mergedReps || []}
            tracks={tracks || {}}
            layers={layers}
            selectedId={selectedPinId || null}
            selectedRepId={selectedRepId || null}
            onSelectPin={(id) => {
              setSelectedPinId(id);
              setFilterStatus(null);
              setSelectedRepId(null);
            }}
            onSelectRep={(id) => {
              setSelectedRepId(id);
              setSelectedPinId(null);
              setFilterStatus(null);
            }}
            testID="lead-map"
          />
          {/* Live WS status indicator */}
          <View style={styles.liveBadge}>
            <View style={[styles.liveDot, { backgroundColor: wsStatus.connected ? colors.secondary : colors.textSecondary }]} />
            <Text style={styles.liveText}>
              {wsStatus.connected ? "LIVE" : wsStatus.reconnectAttempt > 0 ? `reconnect #${wsStatus.reconnectAttempt}` : "polling"}
            </Text>
          </View>
        </View>

        {/* Selected rep callout on web */}
        {selectedRepId && (() => {
          const r = (data?.reps_live || []).find((x: any) => x.user_id === selectedRepId);
          if (!r) return null;
          const act = activityByRepId.get(r.user_id);
          const actStatus = act?.status || r.activity_status;
          const actMins = act?.minutes_ago ?? r.activity_minutes_ago;
          const dotColor = getActivityColor(actStatus, colors);
          return (
            <View style={styles.sectionCard} testID="rep-callout">
              <View style={styles.sectionHead}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                  <View style={[styles.activityDot, { backgroundColor: dotColor }]} testID="rep-activity-dot" />
                  <Text style={styles.sectionTitle}>{r.name}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedRepId(null)}>
                  <Feather name="x" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                {getActivityLabel(actStatus)}
                {typeof actMins === "number" && actMins >= 0 ? ` · ${actMins} min temu` : ""}
                {r.active ? " · w terenie" : ""}
                {typeof r.battery === "number" ? ` · 🔋 ${Math.round(r.battery * 100)}%` : ""}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>
                pos: {r.lat?.toFixed?.(4)}, {r.lng?.toFixed?.(4)}
              </Text>
            </View>
          );
        })()}

        {/* Drill-down list (driven by selectedPinId / filterStatus) */}
        {drilldownLeads.length > 0 && (
          <View style={styles.sectionCard} testID="drilldown-list">
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{drilldownTitle}</Text>
              <TouchableOpacity
                onPress={() => { setFilterStatus(null); setSelectedPinId(null); }}
                testID="clear-drilldown-button"
              >
                <Feather name="x" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {drilldownLeads.map((l) => {
              const c = statusColor[l.status] || colors.primary;
              return (
                <TouchableOpacity
                  key={l.id}
                  style={styles.drillRow}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/(manager)/lead/${l.id}` as any)}
                  testID={`drilldown-lead-${l.id}`}
                >
                  <View style={[styles.drillDot, { backgroundColor: c }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.drillName}>{l.client_name}</Text>
                    <Text style={styles.drillSub} numberOfLines={1}>
                      {l.address || "—"}{l.phone ? ` · ${l.phone}` : ""}
                    </Text>
                  </View>
                  <Text style={[styles.drillStatus, { color: c }]}>{statusLabel[l.status] || l.status}</Text>
                  <Feather name="chevron-right" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Sprint 3.5 — Daily Report (collapsed by default) */}
        <View style={{ marginHorizontal: spacing.md, marginTop: spacing.md }}>
          <DailyReportWidget testID="manager-daily-report" />
        </View>

        {/* Faza 2.1 — Search bar + rep filter chips */}
        <View style={{ marginHorizontal: spacing.md, marginTop: 12 }}>
          <View style={styles.searchBox}>
            <Feather name="search" size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Szukaj: klient, telefon, adres..."
              placeholderTextColor={colors.textSecondary}
              value={searchTerm}
              onChangeText={setSearchTerm}
              testID="manager-search-input"
              returnKeyType="search"
            />
            {searchTerm.length > 0 && (
              <TouchableOpacity onPress={() => setSearchTerm("")} hitSlop={8}>
                <Feather name="x-circle" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          {(data?.rep_progress?.length || 0) > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 8 }}>
              <TouchableOpacity
                style={[styles.filterChip, !filterRepId && styles.filterChipActive]}
                onPress={() => setFilterRepId(null)}
                testID="filter-rep-all"
              >
                <Feather name="users" size={12} color={!filterRepId ? "#fff" : colors.textPrimary} />
                <Text style={[styles.filterChipText, !filterRepId && { color: "#fff" }]}>Wszyscy</Text>
              </TouchableOpacity>
              {(data?.rep_progress || []).map((r: any) => (
                <TouchableOpacity
                  key={r.user_id}
                  style={[styles.filterChip, filterRepId === r.user_id && styles.filterChipActive]}
                  onPress={() => setFilterRepId(filterRepId === r.user_id ? null : r.user_id)}
                  testID={`filter-rep-${r.user_id}`}
                >
                  <Text style={[styles.filterChipText, filterRepId === r.user_id && { color: "#fff" }]}>
                    {(r.name || "").split(" ")[0]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>


        <View style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Cele i postęp</Text>
            <Text style={styles.sectionSub}>Miesiąc</Text>
          </View>
          {/* Sprint 5-pre-bis (ISSUE-UX-004): show max 5 reps inline; user
              can tap "Pokaż wszystkich (N więcej)" to expand the rest in
              place. Sort by signed DESC then by percent DESC so top
              performers always land in the visible 5. */}
          {(() => {
            const allReps = (data?.rep_progress || []) as any[];
            const sortedReps = [...allReps].sort(
              (a, b) =>
                (b.signed || 0) - (a.signed || 0) ||
                (b.percent || 0) - (a.percent || 0)
            );
            const visibleReps = progressExpanded
              ? sortedReps
              : sortedReps.slice(0, 5);
            const overflow = sortedReps.length - 5;
            return (
              <>
                {visibleReps.map((r: any) => (
                  <TouchableOpacity
                    key={r.user_id}
                    onPress={() => router.push(`/(manager)/rep/${r.user_id}` as any)}
                    activeOpacity={0.7}
                    testID={`rep-row-${r.user_id}`}
                  >
                    <ProgressRow rep={r} testID={`rep-progress-${r.user_id}`} />
                  </TouchableOpacity>
                ))}
                {sortedReps.length > 5 && !progressExpanded && (
                  <TouchableOpacity
                    onPress={() => setProgressExpanded(true)}
                    style={styles.expandRow}
                    testID="cele-expand"
                    activeOpacity={0.7}
                  >
                    <Text style={styles.expandText}>
                      Pokaż wszystkich ({overflow} więcej)
                    </Text>
                    <Feather name="chevron-down" size={18} color={colors.primary} />
                  </TouchableOpacity>
                )}
                {sortedReps.length > 5 && progressExpanded && (
                  <TouchableOpacity
                    onPress={() => setProgressExpanded(false)}
                    style={styles.expandRow}
                    testID="cele-collapse"
                    activeOpacity={0.7}
                  >
                    <Text style={styles.expandText}>Zwiń</Text>
                    <Feather name="chevron-up" size={18} color={colors.primary} />
                  </TouchableOpacity>
                )}
                {sortedReps.length === 0 && (
                  <Text style={styles.empty}>Brak przypisanych handlowców</Text>
                )}
              </>
            );
          })()}
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Statusy leadów</Text>
            <Text style={styles.sectionSub}>{data?.total_leads ?? 0} ogółem</Text>
          </View>
          <StatusDonut
            data={data?.status_breakdown || {}}
            selected={filterStatus}
            onSelect={(k) => {
              setFilterStatus(k);
              setSelectedPinId(null);
            }}
            testID="status-donut"
          />
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Top 3 Handlowców</Text>
            <Feather name="award" size={16} color={colors.accent} />
          </View>
          {(data?.top3 || []).map((r: any, i: number) => (
            <ProgressRow rep={r} rank={i + 1} key={r.user_id} testID={`top3-${i}`} />
          ))}
        </View>

        {/* Sprint 5-pre-bis (ISSUE-UX-005) — LeadMap + rep callout + drill-down
            were moved up to be right under the KPI grid (operationally the
            most important block). They're rendered there now; this slot
            is intentionally empty. */}

        <TouchableOpacity
          style={[styles.viewAllBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/(manager)/calendar")}
          testID="manager-calendar-button"
          activeOpacity={0.8}
        >
          <Feather name="calendar" size={16} color={colors.textInverse} />
          <Text style={styles.viewAllText}>Kalendarz spotkań zespołu</Text>
          <Feather name="chevron-right" size={16} color={colors.textInverse} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.viewAllBtn, { marginTop: 10 }]}
          onPress={() => router.push("/(manager)/finance")}
          testID="manager-finance-button"
          activeOpacity={0.8}
        >
          <Feather name="dollar-sign" size={16} color={colors.textInverse} />
          <Text style={styles.viewAllText}>Finanse zespołu — zarobki</Text>
          <Feather name="chevron-right" size={16} color={colors.textInverse} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.viewAllBtn, { backgroundColor: colors.inverted, marginTop: 10 }]}
          onPress={() => router.push("/(manager)/leads")}
          testID="view-all-leads-button"
          activeOpacity={0.8}
        >
          <Feather name="list" size={16} color={colors.textInverse} />
          <Text style={styles.viewAllText}>Wszystkie leady zespołu</Text>
          <Feather name="chevron-right" size={16} color={colors.textInverse} />
        </TouchableOpacity>

        {/* Sprint 5-pre-bis (ISSUE-UX-005) — Commission calculator at the
            very bottom of the dashboard. Collapsed by default (see
            CommissionCalculator.tsx). */}
        <View style={{ marginHorizontal: spacing.md, marginTop: spacing.md }}>
          <CommissionCalculator testID="manager-commission-calculator" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  topbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, paddingTop: 4, paddingBottom: 0 },
  hello: { fontSize: 22, fontWeight: "900", color: colors.textPrimary, letterSpacing: -0.5 },
  today: { fontSize: 12, color: colors.textSecondary, marginTop: 2, textTransform: "capitalize" },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.inverted, alignItems: "center", justifyContent: "center" },
  commandBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  commandText: { fontSize: 10, fontWeight: "900", color: colors.textPrimary, letterSpacing: 2 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.error, marginLeft: "auto" },
  liveText: { fontSize: 10, fontWeight: "900", color: colors.error, letterSpacing: 1 },
  liveBadge: { position: "absolute", top: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.92)", borderWidth: 1, borderColor: colors.border },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, fontWeight: "600" },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.paper },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { fontSize: 12, fontWeight: "800", color: colors.textPrimary },
  kpiGrid: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  sectionCard: { backgroundColor: colors.paper, marginHorizontal: spacing.md, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "900", color: colors.textPrimary, letterSpacing: -0.3 },
  sectionSub: { fontSize: 11, color: colors.textSecondary, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  empty: { color: colors.textSecondary, fontSize: 13, textAlign: "center", paddingVertical: 16 },
  errBox: { marginHorizontal: spacing.md, padding: 12, backgroundColor: "#fef2f2", borderRadius: radius.md, marginTop: spacing.sm },
  errText: { color: colors.error, fontSize: 13 },
  viewAllBtn: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: spacing.md, marginTop: spacing.md, backgroundColor: colors.primary, padding: 16, borderRadius: radius.md, justifyContent: "center" },
  viewAllText: { color: colors.textInverse, fontWeight: "700", fontSize: 15, flex: 1, textAlign: "center" },
  drillRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.zinc100 },
  drillDot: { width: 8, height: 8, borderRadius: 4 },
  drillName: { color: colors.textPrimary, fontWeight: "700", fontSize: 14 },
  drillSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  drillStatus: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  layerBar: { flexDirection: "row", gap: 8, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  layerToggle: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.paper },
  layerCheckbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  layerText: { flex: 1, fontSize: 12, fontWeight: "800", color: colors.textPrimary, letterSpacing: 0.3 },

  // Sprint 4 — status filter chips (above LeadMap)
  statusFilterRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  // Sprint 5-pre-bis (ISSUE-UX-002) — small icon button next to map title
  expandIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Sprint 5-pre-bis (ISSUE-UX-004) — "Pokaż wszystkich (N)" / "Zwiń" row
  expandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.zinc100,
  },
  expandText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.primary,
    letterSpacing: 0.2,
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  statusChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  statusChipDot: { width: 8, height: 8, borderRadius: 4 },
  statusChipText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
    letterSpacing: 0.2,
  },
  // Rep activity dot used in the rep-callout
  activityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.paper,
  },
});
