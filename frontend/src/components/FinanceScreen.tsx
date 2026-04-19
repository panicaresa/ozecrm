import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { useRouter } from "expo-router";
import { colors, radius, spacing } from "../theme";
import { api, formatApiError } from "../lib/api";
import { fmtPln } from "../lib/offerEngine";

export type FinanceRole = "admin" | "manager" | "handlowiec";

interface Contract {
  id: string;
  client_name?: string;
  address?: string;
  updated_at?: string;
  rep_id?: string;
  rep_name?: string;
  area: number;
  building_type: string;
  base_netto: number;
  margin_netto: number;
  total_netto: number;
  vat: number;
  vat_label: string;
  total_brutto: number;
  commission: number;
  commission_percent: number;
}

interface Totals {
  signed_count: number;
  commission_sum: number;
  margin_sum: number;
  netto_sum?: number;
  brutto_sum: number;
  vat_sum?: number;
}

interface RepRow {
  rep_id: string;
  rep_name: string;
  signed_count: number;
  commission_sum: number;
  margin_sum: number;
  brutto_sum: number;
}

interface FinanceData {
  period: { month_start: string; month_end: string };
  settings_snapshot: { commission_percent?: number; margin_per_m2?: number };
  totals_month: Totals;
  totals_all_time: Totals;
  by_rep: RepRow[];
  contracts_month: Contract[];
  contracts_all: Contract[];
}

interface Props {
  role: FinanceRole;
  testID?: string;
}

function polishMonth() {
  return new Date().toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
}

export function FinanceScreen({ role, testID }: Props) {
  const router = useRouter();
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await api.get<FinanceData>("/dashboard/finance");
      setData(res.data);
    } catch (e) {
      setErr(formatApiError(e));
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

  const title = role === "admin" ? "Finanse firmy" : role === "manager" ? "Finanse zespołu" : "Moje zarobki";
  const subtitle = polishMonth();

  const heroKpi = useMemo(() => {
    const t = data?.totals_month;
    if (!t) return [];
    if (role === "handlowiec") {
      return [
        { label: "Zarobiono w tym miesiącu", value: fmtPln(t.commission_sum), big: true, color: colors.secondary },
        { label: "Podpisane umowy", value: String(t.signed_count), color: colors.primary },
        { label: "Moja masa marży", value: fmtPln(t.margin_sum), color: colors.inverted },
      ];
    }
    if (role === "manager") {
      return [
        { label: "Prowizje zespołu (miesiąc)", value: fmtPln(t.commission_sum), big: true, color: colors.secondary },
        { label: "Masa marży zespołu", value: fmtPln(t.margin_sum), color: colors.primary },
        { label: "Podpisane umowy", value: String(t.signed_count), color: colors.accent },
      ];
    }
    // admin
    return [
      { label: "Obrót brutto (miesiąc)", value: fmtPln(t.brutto_sum), big: true, color: colors.inverted },
      { label: "Globalna marża netto", value: fmtPln(t.margin_sum), color: colors.primary },
      { label: "Do wypłaty handlowcom", value: fmtPln(t.commission_sum), color: colors.secondary },
    ];
  }, [data, role]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]} testID={testID}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} testID="finance-back-button">
          <Feather name="arrow-left" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <View style={styles.roleBadge}>
          <Feather name="dollar-sign" size={12} color={colors.secondary} />
          <Text style={styles.roleBadgeText}>{role.toUpperCase()}</Text>
        </View>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
        testID="finance-scroll"
      >
        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}

        {/* Hero KPI */}
        {heroKpi.map((k, idx) => (
          <View
            key={k.label}
            style={[
              styles.kpiCard,
              k.big && styles.kpiHero,
              k.big && { backgroundColor: k.color },
              !k.big && { marginTop: 8 },
              idx === 0 && { marginTop: 0 },
            ]}
            testID={`finance-kpi-${idx}`}
          >
            <Text style={[styles.kpiLabel, k.big && { color: "#DBEAFE" }]}>{k.label}</Text>
            <Text
              style={[
                styles.kpiValue,
                k.big && { color: "#fff", fontSize: 32 },
                !k.big && { color: k.color },
              ]}
            >
              {k.value}
            </Text>
          </View>
        ))}

        {/* Per-rep breakdown (manager & admin only) */}
        {role !== "handlowiec" && (data?.by_rep?.length ?? 0) > 0 && (
          <View style={styles.section} testID="finance-by-rep">
            <Text style={styles.sectionTitle}>Handlowcy w tym miesiącu</Text>
            {data?.by_rep.map((r, i) => (
              <View key={r.rep_id} style={styles.repRow}>
                <View style={[styles.rank, i === 0 && { backgroundColor: colors.accent }]}>
                  <Text style={styles.rankText}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.repName}>{r.rep_name}</Text>
                  <Text style={styles.repSub}>
                    {r.signed_count} umów · marża {fmtPln(r.margin_sum)}
                  </Text>
                </View>
                <Text style={styles.repCommission}>{fmtPln(r.commission_sum)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Contracts list */}
        <View style={styles.section} testID="finance-contracts">
          <Text style={styles.sectionTitle}>
            Podpisane umowy w {subtitle}{" "}
            <Text style={styles.sectionSub}>({data?.contracts_month.length ?? 0})</Text>
          </Text>
          {(data?.contracts_month.length ?? 0) === 0 && (
            <Text style={styles.empty}>Brak podpisanych umów w tym miesiącu.</Text>
          )}
          {data?.contracts_month.map((c) => (
            <View key={c.id} style={styles.contractRow} testID={`finance-contract-${c.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.contractName}>{c.client_name || "—"}</Text>
                <Text style={styles.contractSub} numberOfLines={1}>
                  {c.address || "—"}
                  {role !== "handlowiec" && c.rep_name ? `  ·  ${c.rep_name}` : ""}
                </Text>
                <View style={styles.contractMeta}>
                  <Text style={styles.metaChip}>
                    {c.area} m² · {c.building_type === "gospodarczy" ? "gospodarczy" : "mieszkalny"}
                  </Text>
                  <Text style={styles.metaChip}>VAT {c.vat_label}</Text>
                  <Text style={styles.metaChip}>brutto {fmtPln(c.total_brutto)}</Text>
                </View>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.contractCommissionCap}>PROWIZJA</Text>
                <Text style={styles.contractCommission}>{fmtPln(c.commission)}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* All-time footer */}
        {data && (
          <View style={styles.allTimeBox}>
            <Text style={styles.allTimeTitle}>Łącznie (wszystkie miesiące)</Text>
            <View style={styles.allTimeRow}>
              <Text style={styles.allTimeLabel}>Umów: {data.totals_all_time.signed_count}</Text>
              <Text style={styles.allTimeLabel}>Marża: {fmtPln(data.totals_all_time.margin_sum)}</Text>
            </View>
            <View style={styles.allTimeRow}>
              <Text style={styles.allTimeLabel}>Brutto: {fmtPln(data.totals_all_time.brutto_sum)}</Text>
              <Text style={[styles.allTimeLabel, { color: colors.secondary, fontWeight: "900" }]}>
                Prowizja: {fmtPln(data.totals_all_time.commission_sum)}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", gap: 12, alignItems: "center", padding: spacing.md },
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
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: colors.textSecondary, textTransform: "capitalize" },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: `${colors.secondary}15`,
  },
  roleBadgeText: { color: colors.secondary, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  kpiCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kpiHero: { borderWidth: 0, paddingVertical: 22 },
  kpiLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  kpiValue: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  section: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { fontSize: 14, fontWeight: "900", color: colors.textPrimary, marginBottom: 10 },
  sectionSub: { fontSize: 11, color: colors.textSecondary, fontWeight: "700" },
  repRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc100,
  },
  rank: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.zinc200,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: { color: "#fff", fontWeight: "900", fontSize: 11 },
  repName: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  repSub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  repCommission: { fontSize: 15, fontWeight: "900", color: colors.secondary, fontVariant: ["tabular-nums"] },
  contractRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc100,
    gap: 10,
  },
  contractName: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  contractSub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  contractMeta: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  metaChip: {
    fontSize: 10,
    color: colors.textSecondary,
    backgroundColor: colors.zinc100,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontWeight: "700",
  },
  contractCommissionCap: { fontSize: 9, color: colors.textSecondary, fontWeight: "800", letterSpacing: 1 },
  contractCommission: { fontSize: 16, fontWeight: "900", color: colors.secondary, fontVariant: ["tabular-nums"] },
  empty: { color: colors.textSecondary, fontSize: 13, textAlign: "center", paddingVertical: 16 },
  allTimeBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.inverted,
  },
  allTimeTitle: {
    color: colors.textInverseSecondary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  allTimeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  allTimeLabel: { color: "#fff", fontSize: 12, fontWeight: "700" },
  errBox: { padding: 12, backgroundColor: "#fef2f2", borderRadius: radius.md, marginBottom: 10 },
  errText: { color: colors.error, fontSize: 13 },
});
