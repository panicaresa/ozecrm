import React, { useCallback, useEffect, useState } from "react";
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
import { colors, radius, spacing } from "../../src/theme";
import { api, formatApiError } from "../../src/lib/api";
import { useAuth } from "../../src/lib/auth";
import { KpiTile } from "../../src/components/KpiTile";
import { ProgressRow } from "../../src/components/ProgressRow";
import { StatusDonut } from "../../src/components/StatusDonut";
import { LeadMap } from "../../src/components/LeadMap";

interface Dashboard {
  kpi: { meetings: number; new_leads: number; quotes: number; active_reps: number };
  status_breakdown: Record<string, number>;
  rep_progress: any[];
  top3: any[];
  pins: any[];
  total_leads: number;
}

export default function ManagerDashboard() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await api.get<Dashboard>("/dashboard/manager");
      setData(res.data);
    } catch (e: any) {
      setErr(formatApiError(e, "Nie udało się pobrać danych"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

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
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Witaj, {user?.name?.split(" ")[0] || "Managerze"}</Text>
            <Text style={styles.today}>
              {new Date().toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })}
            </Text>
          </View>
          <TouchableOpacity style={styles.iconBtn} onPress={handleLogout} testID="logout-button">
            <Feather name="log-out" size={18} color={colors.textInverse} />
          </TouchableOpacity>
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

        {/* KPI row */}
        <View style={styles.kpiGrid}>
          <KpiTile label="Spotkania" value={data?.kpi.meetings ?? 0} icon="calendar" accent={colors.warning} testID="kpi-meetings" />
          <KpiTile label="Nowe leady" value={data?.kpi.new_leads ?? 0} icon="user-plus" accent={colors.success} testID="kpi-new-leads" />
        </View>
        <View style={styles.kpiGrid}>
          <KpiTile label="Wyceny" value={data?.kpi.quotes ?? 0} icon="file-text" accent={colors.secondary} testID="kpi-quotes" />
          <KpiTile label="Aktywni w terenie" value={data?.kpi.active_reps ?? 0} icon="users" accent={colors.primary} testID="kpi-active-reps" />
        </View>

        {/* Progress */}
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

        {/* Status donut */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Statusy leadów</Text>
            <Text style={styles.sectionSub}>{data?.total_leads ?? 0} ogółem</Text>
          </View>
          <StatusDonut data={data?.status_breakdown || {}} testID="status-donut" />
        </View>

        {/* Top 3 */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Top 3 Handlowców</Text>
            <Feather name="award" size={16} color={colors.warning} />
          </View>
          {(data?.top3 || []).map((r: any, i: number) => (
            <ProgressRow rep={r} rank={i + 1} key={r.user_id} testID={`top3-${i}`} />
          ))}
        </View>

        {/* Lead map */}
        <View style={[styles.sectionCard, { padding: 0, overflow: "hidden" }]}>
          <View style={[styles.sectionHead, { padding: spacing.md }]}>
            <Text style={styles.sectionTitle}>Lead Map</Text>
            <Text style={styles.sectionSub}>{(data?.pins || []).length} z lokalizacją</Text>
          </View>
          <LeadMap pins={data?.pins || []} testID="lead-map" />
        </View>

        <TouchableOpacity
          style={styles.viewAllBtn}
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
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, paddingBottom: 0 },
  hello: { fontSize: 22, fontWeight: "900", color: colors.textPrimary, letterSpacing: -0.5 },
  today: { fontSize: 12, color: colors.textSecondary, marginTop: 2, textTransform: "capitalize" },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.inverted, alignItems: "center", justifyContent: "center" },
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
});
