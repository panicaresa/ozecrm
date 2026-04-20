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
  rep_id?: string;
  rep_name?: string;
  signed_at?: string;
  buildings_count?: number;
  building_type?: string;
  roof_area_m2?: number;
  gross_amount?: number;
  global_margin?: number;
  financing_type?: string;
  down_payment_amount?: number;
  installments_count?: number;
  total_paid_amount?: number;
  commission_amount?: number;
  commission_percent?: number;
  status: "frozen" | "partial" | "payable" | "cancelled";
  commission_total: number;
  commission_released: number;
  commission_frozen: number;
  paid_pct: number;
  release_date?: string;
  days_until_release?: number;
}

interface FinanceData {
  period: { month_start: string; month_end: string };
  settings_snapshot: { commission_percent?: number; withdrawal_days?: number };
  totals_month: {
    signed_count: number;
    commission_payable_sum: number;
    commission_frozen_sum: number;
    commission_total_sum: number;
    margin_sum: number;
    brutto_sum: number;
  };
  totals_all_time: {
    signed_count: number;
    commission_payable_sum: number;
    commission_frozen_sum: number;
    commission_total_sum: number;
    margin_sum: number;
    brutto_sum: number;
  };
  by_rep: {
    rep_id: string;
    rep_name: string;
    signed_count: number;
    commission_payable_sum: number;
    commission_frozen_sum: number;
    margin_sum: number;
    brutto_sum: number;
  }[];
  frozen_contracts: Contract[];
  partial_contracts: Contract[];
  payable_contracts: Contract[];
  contracts_month: Contract[];
}

interface Props {
  role: FinanceRole;
  testID?: string;
}

function polishMonth() {
  return new Date().toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
}

function fmtDate(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: Contract["status"] }) {
  const map = {
    frozen: { bg: "#E0F2FE", fg: "#0369A1", label: "Zamrożona", icon: "clock" as const },
    partial: { bg: "#FEF3C7", fg: "#92400E", label: "Częściowa", icon: "pie-chart" as const },
    payable: { bg: "#DCFCE7", fg: "#166534", label: "Do wypłaty", icon: "check-circle" as const },
    cancelled: { bg: "#FEE2E2", fg: "#991B1B", label: "Anulowana", icon: "x-circle" as const },
  }[status];
  return (
    <View style={[badgeStyles.wrap, { backgroundColor: map.bg }]}>
      <Feather name={map.icon} size={10} color={map.fg} />
      <Text style={{ color: map.fg, fontWeight: "900", fontSize: 10, letterSpacing: 0.5 }}>{map.label}</Text>
    </View>
  );
}

function ContractRow({ c, role, showReleaseCountdown }: { c: Contract; role: FinanceRole; showReleaseCountdown?: boolean }) {
  const isFrozen = c.status === "frozen";
  return (
    <View style={styles.contractRow} testID={`contract-${c.id}`}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.contractName} numberOfLines={1}>{c.client_name || "—"}</Text>
          <StatusBadge status={c.status} />
        </View>
        <Text style={styles.contractSub} numberOfLines={1}>
          {fmtDate(c.signed_at)} · {c.roof_area_m2} m² · {c.building_type === "gospodarczy" ? "gospodarczy" : "mieszkalny"}
          {role !== "handlowiec" && c.rep_name ? `  ·  ${c.rep_name}` : ""}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaChip}>
            {c.financing_type === "credit" ? "💳 Kredyt" : "💵 Gotówka"}
          </Text>
          <Text style={styles.metaChip}>brutto {fmtPln(c.gross_amount || 0)}</Text>
          {c.financing_type === "cash" && typeof c.paid_pct === "number" && (
            <Text style={styles.metaChip}>opłacono {c.paid_pct.toFixed(0)}%</Text>
          )}
        </View>
        {showReleaseCountdown && isFrozen && typeof c.days_until_release === "number" && (
          <Text style={styles.countdown}>
            ⏳ Uwolnienie za {c.days_until_release} dni · {fmtDate(c.release_date)}
          </Text>
        )}
      </View>
      <View style={{ alignItems: "flex-end", minWidth: 90 }}>
        <Text style={styles.commissionCap}>PROWIZJA</Text>
        {isFrozen ? (
          <>
            <Text style={[styles.commissionAmount, { color: colors.info, textDecorationLine: "line-through", fontSize: 13 }]}>
              {fmtPln(c.commission_total)}
            </Text>
            <Text style={styles.commissionSub}>zamrożona</Text>
          </>
        ) : c.status === "partial" ? (
          <>
            <Text style={[styles.commissionAmount, { color: colors.accent }]}>{fmtPln(c.commission_released)}</Text>
            <Text style={styles.commissionSub}>z {fmtPln(c.commission_total)}</Text>
          </>
        ) : (
          <Text style={[styles.commissionAmount, { color: colors.secondary }]}>{fmtPln(c.commission_released)}</Text>
        )}
      </View>
    </View>
  );
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
      const res = await api.get<FinanceData>("/dashboard/finance-v2");
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
        { label: "Do wypłaty (pewne)", value: fmtPln(t.commission_payable_sum), big: true, color: colors.secondary, icon: "check-circle" as const },
        { label: "Zamrożone (14 dni)", value: fmtPln(t.commission_frozen_sum), color: colors.info, icon: "clock" as const },
        { label: "Podpisane umowy", value: String(t.signed_count), color: colors.primary, icon: "file-text" as const },
      ];
    }
    if (role === "manager") {
      return [
        { label: "Zespół — do wypłaty", value: fmtPln(t.commission_payable_sum), big: true, color: colors.secondary, icon: "check-circle" as const },
        { label: "Zespół — zamrożone", value: fmtPln(t.commission_frozen_sum), color: colors.info, icon: "clock" as const },
        { label: "Masa marży zespołu", value: fmtPln(t.margin_sum), color: colors.primary, icon: "trending-up" as const },
      ];
    }
    // admin
    return [
      { label: "Obrót brutto (miesiąc)", value: fmtPln(t.brutto_sum), big: true, color: colors.inverted, icon: "dollar-sign" as const },
      { label: "Globalna marża netto", value: fmtPln(t.margin_sum), color: colors.primary, icon: "trending-up" as const },
      { label: "Do wypłaty handlowcom", value: fmtPln(t.commission_payable_sum), color: colors.secondary, icon: "check-circle" as const },
      { label: "Zamrożone (14 dni)", value: fmtPln(t.commission_frozen_sum), color: colors.info, icon: "clock" as const },
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

  const withdrawalDays = data?.settings_snapshot?.withdrawal_days ?? 14;

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
      >
        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}

        {/* Hero KPIs */}
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
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Feather name={k.icon as any} size={12} color={k.big ? "#DBEAFE" : colors.textSecondary} />
              <Text style={[styles.kpiLabel, k.big && { color: "#DBEAFE" }]}>{k.label}</Text>
            </View>
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

        {/* Rule explainer */}
        <View style={styles.ruleBox}>
          <Feather name="shield" size={14} color={colors.info} />
          <Text style={styles.ruleText}>
            Prowizja jest zamrażana przez <Text style={{ fontWeight: "900" }}>{withdrawalDays} dni</Text> (ustawowe prawo odstąpienia od umowy).
            Po tym czasie — przy kredycie uwalniana w 100%, przy gotówce w transzach — proporcjonalnie do % opłaconej kwoty.
          </Text>
        </View>

        {/* Per-rep breakdown (manager & admin) */}
        {role !== "handlowiec" && (data?.by_rep?.length ?? 0) > 0 && (
          <View style={styles.section}>
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
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.repPayable}>{fmtPln(r.commission_payable_sum)}</Text>
                  {r.commission_frozen_sum > 0 && (
                    <Text style={styles.repFrozen}>+ {fmtPln(r.commission_frozen_sum)} ⏳</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Frozen section */}
        {(data?.frozen_contracts?.length ?? 0) > 0 && (
          <View style={[styles.section, { borderLeftWidth: 4, borderLeftColor: colors.info }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <Feather name="clock" size={14} color={colors.info} />
              <Text style={styles.sectionTitle}>
                Zamrożone (w trakcie 14 dni){" "}
                <Text style={styles.sectionSub}>({data?.frozen_contracts.length})</Text>
              </Text>
            </View>
            {data?.frozen_contracts.map((c) => (
              <ContractRow key={c.id} c={c} role={role} showReleaseCountdown />
            ))}
          </View>
        )}

        {/* Partial section */}
        {(data?.partial_contracts?.length ?? 0) > 0 && (
          <View style={[styles.section, { borderLeftWidth: 4, borderLeftColor: colors.accent }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <Feather name="pie-chart" size={14} color={colors.accent} />
              <Text style={styles.sectionTitle}>
                Częściowo do wypłaty{" "}
                <Text style={styles.sectionSub}>({data?.partial_contracts.length})</Text>
              </Text>
            </View>
            {data?.partial_contracts.map((c) => (
              <ContractRow key={c.id} c={c} role={role} />
            ))}
          </View>
        )}

        {/* Payable section */}
        {(data?.payable_contracts?.length ?? 0) > 0 && (
          <View style={[styles.section, { borderLeftWidth: 4, borderLeftColor: colors.secondary }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <Feather name="check-circle" size={14} color={colors.secondary} />
              <Text style={styles.sectionTitle}>
                Do wypłaty (pewne){" "}
                <Text style={styles.sectionSub}>({data?.payable_contracts.length})</Text>
              </Text>
            </View>
            {data?.payable_contracts.map((c) => (
              <ContractRow key={c.id} c={c} role={role} />
            ))}
          </View>
        )}

        {(data?.frozen_contracts.length === 0 && data?.partial_contracts.length === 0 && data?.payable_contracts.length === 0) && (
          <View style={styles.empty}>
            <Feather name="inbox" size={32} color={colors.textSecondary} />
            <Text style={styles.emptyText}>Brak podpisanych umów</Text>
            <Text style={styles.emptySub}>Umowy pojawią się tu, gdy handlowiec doda je z poziomu leada (przycisk „Dodaj umowę").</Text>
          </View>
        )}

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
                Do wypłaty: {fmtPln(data.totals_all_time.commission_payable_sum)}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const badgeStyles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", gap: 12, alignItems: "center", padding: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: colors.textSecondary, textTransform: "capitalize" },
  roleBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: `${colors.secondary}15` },
  roleBadgeText: { color: colors.secondary, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  kpiCard: { backgroundColor: colors.paper, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  kpiHero: { borderWidth: 0, paddingVertical: 22 },
  kpiLabel: { fontSize: 11, fontWeight: "800", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 1.2 },
  kpiValue: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5, marginTop: 6, fontVariant: ["tabular-nums"] },
  ruleBox: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: `${colors.info}10`, padding: 12, borderRadius: radius.md, marginTop: 12, borderWidth: 1, borderColor: `${colors.info}40` },
  ruleText: { flex: 1, fontSize: 11, color: colors.textPrimary, lineHeight: 16 },
  section: { backgroundColor: colors.paper, borderRadius: radius.lg, padding: spacing.md, marginTop: 12, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { fontSize: 14, fontWeight: "900", color: colors.textPrimary },
  sectionSub: { fontSize: 11, color: colors.textSecondary, fontWeight: "700" },
  repRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.zinc100 },
  rank: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.zinc200, alignItems: "center", justifyContent: "center" },
  rankText: { color: "#fff", fontWeight: "900", fontSize: 11 },
  repName: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  repSub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  repPayable: { fontSize: 14, fontWeight: "900", color: colors.secondary, fontVariant: ["tabular-nums"] },
  repFrozen: { fontSize: 10, color: colors.info, marginTop: 2, fontWeight: "700" },
  contractRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.zinc100, gap: 10 },
  contractName: { fontSize: 14, fontWeight: "800", color: colors.textPrimary, flex: 1 },
  contractSub: { fontSize: 11, color: colors.textSecondary, marginTop: 3 },
  metaRow: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  metaChip: { fontSize: 10, color: colors.textSecondary, backgroundColor: colors.zinc100, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontWeight: "700" },
  countdown: { fontSize: 11, color: colors.info, marginTop: 6, fontWeight: "800" },
  commissionCap: { fontSize: 9, color: colors.textSecondary, fontWeight: "800", letterSpacing: 1 },
  commissionAmount: { fontSize: 16, fontWeight: "900", fontVariant: ["tabular-nums"] },
  commissionSub: { fontSize: 10, color: colors.textSecondary, fontWeight: "700", marginTop: 1 },
  empty: { alignItems: "center", padding: 32, marginTop: 12, backgroundColor: colors.paper, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, gap: 8 },
  emptyText: { fontSize: 14, fontWeight: "800", color: colors.textPrimary, marginTop: 4 },
  emptySub: { fontSize: 12, color: colors.textSecondary, textAlign: "center", lineHeight: 16 },
  allTimeBox: { marginTop: 16, padding: 14, borderRadius: radius.md, backgroundColor: colors.inverted },
  allTimeTitle: { color: colors.textInverseSecondary, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 },
  allTimeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  allTimeLabel: { color: "#fff", fontSize: 12, fontWeight: "700" },
  errBox: { padding: 12, backgroundColor: "#fef2f2", borderRadius: radius.md, marginBottom: 10 },
  errText: { color: colors.error, fontSize: 13 },
});
