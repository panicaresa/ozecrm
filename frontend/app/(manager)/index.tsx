import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
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
import { CommissionCalculator } from "../../src/components/CommissionCalculator";
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
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
  const [layers, setLayers] = useState({ leads: true, reps: true });

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
    if (filterStatus) return leads.filter((l) => l.status === filterStatus);
    return [];
  }, [leads, filterStatus, selectedPinId]);

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
          <TouchableOpacity style={styles.iconBtn} onPress={handleLogout} testID="logout-button">
            <Feather name="log-out" size={18} color={colors.textInverse} />
          </TouchableOpacity>
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

        {/* Szybki kalkulator prowizji */}
        <View style={{ marginHorizontal: spacing.md, marginTop: spacing.md }}>
          <CommissionCalculator testID="manager-commission-calculator" />
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Cele i postęp</Text>
            <Text style={styles.sectionSub}>Miesiąc</Text>
          </View>
          {(data?.rep_progress || []).map((r: any) => (
            <ProgressRow rep={r} key={r.user_id} testID={`rep-progress-${r.user_id}`} />
          ))}
          {(data?.rep_progress?.length || 0) === 0 && (
            <Text style={styles.empty}>Brak przypisanych handlowców</Text>
          )}
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

        <View style={[styles.sectionCard, { padding: 0, overflow: "hidden" }]}>
          <View style={[styles.sectionHead, { padding: spacing.md, paddingBottom: 8 }]}>
            <Text style={styles.sectionTitle}>Lead Map · Live</Text>
            <Text style={styles.sectionSub}>
              {(data?.pins || []).length} leadów · {(data?.reps_live || []).length} handlowców
            </Text>
          </View>

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
            pins={data?.pins || []}
            reps={data?.reps_live || []}
            layers={layers}
            selectedId={selectedPinId}
            selectedRepId={selectedRepId}
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
        </View>

        {/* Selected rep callout on web */}
        {selectedRepId && (() => {
          const r = (data?.reps_live || []).find((x: any) => x.user_id === selectedRepId);
          if (!r) return null;
          return (
            <View style={styles.sectionCard} testID="rep-callout">
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>{r.name}</Text>
                <TouchableOpacity onPress={() => setSelectedRepId(null)}>
                  <Feather name="x" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                {r.active ? "Aktywny w terenie" : "Offline"} · ostatnia pozycja {r.lat?.toFixed?.(4)}, {r.lng?.toFixed?.(4)}
                {typeof r.battery === "number" ? ` · 🔋 ${Math.round(r.battery * 100)}%` : ""}
              </Text>
            </View>
          );
        })()}

        {/* Drill-down list */}
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
});
