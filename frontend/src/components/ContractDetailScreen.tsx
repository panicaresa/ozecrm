import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, radius, spacing } from "../../src/theme";
import { api, formatApiError } from "../../src/lib/api";
import { fmtPln } from "../../src/lib/offerEngine";
import { useAuth } from "../../src/lib/auth";

interface Contract {
  id: string;
  client_name?: string;
  rep_name?: string;
  signed_at?: string;
  roof_area_m2?: number;
  buildings_count?: number;
  building_type?: string;
  gross_amount?: number;
  global_margin?: number;
  financing_type?: string;
  down_payment_amount?: number;
  installments_count?: number;
  total_paid_amount?: number;
  commission_percent?: number;
  commission_amount?: number;
  commission_total: number;
  commission_total_original?: number;
  commission_released: number;
  commission_frozen: number;
  effective_margin?: number;
  additional_costs?: number;
  additional_costs_note?: string;
  paid_pct?: number;
  release_date?: string;
  days_until_release?: number;
  status: "frozen" | "partial" | "payable" | "cancelled";
  note?: string;
  cancelled?: boolean;
}

interface AuditEntry {
  id: string;
  field: string;
  old_value: any;
  new_value: any;
  changed_by_name?: string;
  changed_by_role?: string;
  changed_at?: string;
  reason_note?: string;
}

export default function ContractDetail() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const [contract, setContract] = useState<Contract | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [paid, setPaid] = useState("");
  const [addCosts, setAddCosts] = useState("");
  const [addCostsNote, setAddCostsNote] = useState("");

  const canEditPaid = user?.role === "admin" || user?.role === "manager";
  const canEditCosts = user?.role === "admin";

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [resC, resA] = await Promise.all([
        api.get<Contract>(`/contracts/${id}`),
        api.get<AuditEntry[]>(`/contracts/${id}/audit-log`).catch(() => ({ data: [] as AuditEntry[] })),
      ]);
      setContract(resC.data);
      setAuditLog(resA.data);
      setPaid(String(resC.data.total_paid_amount ?? 0));
      setAddCosts(String(resC.data.additional_costs ?? 0));
      setAddCostsNote(resC.data.additional_costs_note || "");
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await api.patch(`/contracts/${id}`, patch);
      setContract(res.data);
      Alert.alert("Zapisano", "Dane umowy zostały zaktualizowane.");
    } catch (e) {
      Alert.alert("Błąd", formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const savePaid = () => {
    const n = parseFloat(paid.replace(",", "."));
    if (!isFinite(n) || n < 0) { Alert.alert("Błąd", "Podaj poprawną kwotę >= 0"); return; }
    save({ total_paid_amount: n });
  };

  const saveCorrection = () => {
    const n = parseFloat(addCosts.replace(",", "."));
    if (!isFinite(n) || n < 0) { Alert.alert("Błąd", "Podaj poprawną kwotę >= 0"); return; }
    save({ additional_costs: n, additional_costs_note: addCostsNote || null });
  };

  const toggleCancel = () => {
    if (!contract) return;
    const willCancel = !contract.cancelled;
    Alert.alert(
      willCancel ? "Anulować umowę?" : "Przywrócić umowę?",
      willCancel ? "Prowizja zostanie wyzerowana." : "Prowizja zostanie przywrócona.",
      [
        { text: "Anuluj", style: "cancel" },
        { text: "Tak", onPress: () => save({ cancelled: willCancel }) },
      ]
    );
  };

  const dateFormatted = useMemo(() => {
    if (!contract?.signed_at) return "—";
    try { return new Date(contract.signed_at).toLocaleDateString("pl-PL", { day: "2-digit", month: "long", year: "numeric" }); } catch { return contract.signed_at; }
  }, [contract?.signed_at]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (err || !contract) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={{ padding: spacing.md }}>
          <Text style={styles.err}>{err || "Nie znaleziono umowy"}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasCorrection = (contract.additional_costs || 0) > 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]} testID="contract-detail-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()} testID="contract-detail-back">
            <Feather name="arrow-left" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Szczegóły umowy</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{contract.client_name || "—"}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {/* Alert for rep: correction applied */}
          {user?.role === "handlowiec" && hasCorrection && (
            <View style={styles.correctionAlert} testID="rep-correction-alert">
              <Feather name="alert-triangle" size={16} color="#92400E" />
              <View style={{ flex: 1 }}>
                <Text style={styles.correctionAlertTitle}>
                  Korekta powykonawcza: -{fmtPln(contract.additional_costs || 0)}
                </Text>
                {contract.additional_costs_note && (
                  <Text style={styles.correctionAlertNote}>Powód: {contract.additional_costs_note}</Text>
                )}
                <Text style={styles.correctionAlertNote}>
                  Efektywna marża: {fmtPln(contract.effective_margin || 0)} · Prowizja: {fmtPln(contract.commission_total)}
                </Text>
              </View>
            </View>
          )}

          {/* Summary card */}
          <View style={styles.card}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Status</Text>
              <View style={[styles.statusPill, { backgroundColor: statusColors[contract.status].bg }]}>
                <Text style={{ color: statusColors[contract.status].fg, fontWeight: "900", fontSize: 10, letterSpacing: 0.5 }}>
                  {statusLabels[contract.status]}
                </Text>
              </View>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Data podpisania</Text>
              <Text style={styles.summaryValue}>{dateFormatted}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Finansowanie</Text>
              <Text style={styles.summaryValue}>{contract.financing_type === "credit" ? "💳 Kredyt" : "💵 Gotówka"}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Metraż · typ</Text>
              <Text style={styles.summaryValue}>{contract.roof_area_m2} m² · {contract.building_type}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Cena brutto</Text>
              <Text style={styles.summaryValueBold}>{fmtPln(contract.gross_amount || 0)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Marża globalna (oryginał)</Text>
              <Text style={styles.summaryValue}>{fmtPln(contract.global_margin || 0)}</Text>
            </View>
            {hasCorrection && (
              <>
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: "#92400E" }]}>− Korekta powykonawcza</Text>
                  <Text style={[styles.summaryValue, { color: "#92400E" }]}>− {fmtPln(contract.additional_costs || 0)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { fontWeight: "900", color: colors.textPrimary }]}>Marża efektywna</Text>
                  <Text style={[styles.summaryValueBold, { color: colors.secondary }]}>{fmtPln(contract.effective_margin || 0)}</Text>
                </View>
              </>
            )}
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { fontWeight: "900", color: colors.textPrimary }]}>Prowizja handlowca</Text>
              <Text style={[styles.summaryValueBold, { color: colors.secondary, fontSize: 16 }]}>{fmtPln(contract.commission_total)}</Text>
            </View>
            {hasCorrection && contract.commission_total_original !== contract.commission_total && (
              <Text style={styles.hintSmall}>
                Oryginalnie: {fmtPln(contract.commission_total_original || 0)} · po korekcie: {fmtPln(contract.commission_total)}
              </Text>
            )}
          </View>

          {/* Payment tracking (admin & manager) */}
          {canEditPaid && contract.financing_type === "cash" && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Kontrola wpłat (gotówka)</Text>
              <Text style={styles.hintSmall}>
                Wpisz rzeczywiście opłaconą łączną kwotę. System proporcjonalnie uwolni prowizję po 14 dniach.
              </Text>
              <Text style={styles.label}>Faktycznie wpłacona kwota (PLN)</Text>
              <TextInput
                style={styles.input}
                value={paid}
                onChangeText={setPaid}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                testID="contract-paid-input"
              />
              <Text style={styles.hintSmall}>
                {contract.gross_amount ? `${(parseFloat(paid || "0") / contract.gross_amount * 100).toFixed(1)}% z ceny brutto` : ""}
              </Text>
              <TouchableOpacity style={styles.btn} onPress={savePaid} disabled={saving} testID="save-paid-button">
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Zapisz wpłatę</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* Admin corrections */}
          {canEditCosts && (
            <View style={[styles.card, { borderColor: colors.accent, borderWidth: 2 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Feather name="alert-triangle" size={16} color={colors.accent} />
                <Text style={styles.sectionTitle}>Korekta powykonawcza (Admin)</Text>
              </View>
              <Text style={styles.hintSmall}>
                Wpisz koszty dodatkowe które pomniejszają marżę i prowizję (np. nieprzewidziane wydatki przy wymianie dachu).
                Prowizja handlowca przelicza się automatycznie.
              </Text>
              <Text style={styles.label}>Koszty dodatkowe (PLN)</Text>
              <TextInput
                style={styles.input}
                value={addCosts}
                onChangeText={setAddCosts}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                testID="contract-costs-input"
              />
              <Text style={styles.label}>Notatka / Uzasadnienie</Text>
              <TextInput
                style={[styles.input, { height: 80 }]}
                value={addCostsNote}
                onChangeText={setAddCostsNote}
                multiline
                placeholder="np. wymiana uszkodzonej więźby, +3000 zł"
                placeholderTextColor={colors.textSecondary}
                testID="contract-costs-note-input"
              />
              <TouchableOpacity style={[styles.btn, { backgroundColor: colors.accent }]} onPress={saveCorrection} disabled={saving} testID="save-correction-button">
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Zapisz korektę</Text>}
              </TouchableOpacity>
              {hasCorrection && (
                <Text style={[styles.hintSmall, { marginTop: 8, color: colors.accent }]}>
                  ✓ Korekta aktywna. Prowizja handlowca pomniejszona z {fmtPln(contract.commission_total_original || 0)} do {fmtPln(contract.commission_total)}.
                </Text>
              )}
            </View>
          )}

          {/* Cancel button */}
          {canEditPaid && (
            <TouchableOpacity
              style={[styles.cancelBtn, contract.cancelled && { backgroundColor: colors.primary }]}
              onPress={toggleCancel}
              disabled={saving}
              testID="toggle-cancel-button"
            >
              <Feather name={contract.cancelled ? "refresh-ccw" : "x-circle"} size={16} color="#fff" />
              <Text style={styles.btnText}>
                {contract.cancelled ? "Przywróć umowę" : "Anuluj umowę"}
              </Text>
            </TouchableOpacity>
          )}

          {/* Audit log viewer */}
          {auditLog.length > 0 && (
            <View style={styles.card}>
              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                onPress={() => setShowAudit((v) => !v)}
                testID="audit-toggle"
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Feather name="clock" size={14} color={colors.textPrimary} />
                  <Text style={styles.sectionTitle}>
                    Historia zmian <Text style={{ color: colors.textSecondary, fontWeight: "700" }}>({auditLog.length})</Text>
                  </Text>
                </View>
                <Feather name={showAudit ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
              </TouchableOpacity>
              {showAudit && (
                <View style={{ marginTop: 10 }}>
                  {auditLog.map((e) => {
                    const fieldLabel: Record<string, string> = {
                      total_paid_amount: "Wpłata",
                      additional_costs: "Koszty dodatkowe",
                      additional_costs_note: "Uzasadnienie korekty",
                      cancelled: "Anulowanie",
                      note: "Notatka",
                    };
                    const fmtVal = (v: any) => {
                      if (v === null || v === undefined) return "—";
                      if (typeof v === "number") return fmtPln(v);
                      if (typeof v === "boolean") return v ? "TAK" : "NIE";
                      return String(v).slice(0, 40);
                    };
                    return (
                      <View key={e.id} style={styles.auditRow} testID={`audit-entry-${e.id}`}>
                        <View style={styles.auditDot} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.auditField}>{fieldLabel[e.field] || e.field}</Text>
                          <Text style={styles.auditChange}>
                            {fmtVal(e.old_value)} → <Text style={{ fontWeight: "900", color: colors.textPrimary }}>{fmtVal(e.new_value)}</Text>
                          </Text>
                          {e.reason_note ? <Text style={styles.auditReason}>📝 {e.reason_note}</Text> : null}
                          <Text style={styles.auditBy}>
                            {e.changed_by_name || "—"} · {e.changed_by_role?.toUpperCase()} · {e.changed_at ? new Date(e.changed_at).toLocaleString("pl-PL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          <Text style={[styles.hintSmall, { textAlign: "center", marginTop: 16 }]}>
            ID: {contract.id.slice(0, 8)}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const statusColors: Record<string, { bg: string; fg: string }> = {
  frozen: { bg: "#E0F2FE", fg: "#0369A1" },
  partial: { bg: "#FEF3C7", fg: "#92400E" },
  payable: { bg: "#DCFCE7", fg: "#166534" },
  cancelled: { bg: "#FEE2E2", fg: "#991B1B" },
};
const statusLabels: Record<string, string> = {
  frozen: "Zamrożona",
  partial: "Częściowa",
  payable: "Do wypłaty",
  cancelled: "Anulowana",
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", gap: 12, alignItems: "center", padding: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary },
  card: { backgroundColor: colors.paper, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, gap: 10 },
  summaryLabel: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  summaryValue: { fontSize: 13, color: colors.textPrimary, fontWeight: "700", fontVariant: ["tabular-nums"] },
  summaryValueBold: { fontSize: 14, color: colors.textPrimary, fontWeight: "900", fontVariant: ["tabular-nums"] },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  sectionTitle: { fontSize: 14, fontWeight: "900", color: colors.textPrimary },
  hintSmall: { fontSize: 11, color: colors.textSecondary, lineHeight: 15, marginTop: 4 },
  label: { fontSize: 10, color: colors.textSecondary, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, fontWeight: "700", color: colors.textPrimary, backgroundColor: colors.bg },
  btn: { marginTop: 12, flexDirection: "row", justifyContent: "center", alignItems: "center", backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md },
  btnText: { color: "#fff", fontWeight: "900", fontSize: 14, letterSpacing: 0.3 },
  cancelBtn: { flexDirection: "row", gap: 8, justifyContent: "center", alignItems: "center", backgroundColor: colors.error, paddingVertical: 14, borderRadius: radius.md, marginTop: 12 },
  correctionAlert: { flexDirection: "row", gap: 10, padding: 14, borderRadius: radius.md, backgroundColor: "#FEF3C7", borderWidth: 1.5, borderColor: "#F59E0B", marginBottom: 12, alignItems: "flex-start" },
  correctionAlertTitle: { color: "#92400E", fontWeight: "900", fontSize: 14 },
  correctionAlertNote: { color: "#92400E", fontSize: 12, marginTop: 3, lineHeight: 16 },
  auditRow: { flexDirection: "row", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.zinc100 },
  auditDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary, marginTop: 8 },
  auditField: { fontSize: 12, fontWeight: "900", color: colors.textPrimary, textTransform: "uppercase", letterSpacing: 0.5 },
  auditChange: { fontSize: 12, color: colors.textSecondary, marginTop: 3 },
  auditReason: { fontSize: 11, color: colors.accent, marginTop: 3, fontStyle: "italic" },
  auditBy: { fontSize: 10, color: colors.textSecondary, marginTop: 4 },
  err: { color: colors.error, fontSize: 14 },
});
