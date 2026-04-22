import React, { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
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

type Financing = "credit" | "cash";
type BuildingType = "mieszkalny" | "gospodarczy";

export default function AddContract() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const leadId = String(params.leadId || "");
  const clientName = String(params.clientName || "");
  const preArea = String(params.area || "");
  const preType = (params.buildingType as BuildingType) || "mieszkalny";

  const [signedAt, setSignedAt] = useState<string>(new Date().toISOString().slice(0, 10));
  const [buildingsCount, setBuildingsCount] = useState("1");
  const [buildingType, setBuildingType] = useState<BuildingType>(preType);
  const [roofArea, setRoofArea] = useState(preArea);
  const [grossAmount, setGrossAmount] = useState("");
  const [globalMargin, setGlobalMargin] = useState("");
  const [financing, setFinancing] = useState<Financing>("credit");
  const [downPayment, setDownPayment] = useState("");
  const [installments, setInstallments] = useState("1");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // K6: Idempotency key — stable for this form instance (retries use same key)
  const idempotencyKey = useRef<string>(
    `ctr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  const asNumber = (s: string, def = 0) => {
    const n = parseFloat((s || "").replace(",", "."));
    return isFinite(n) ? n : def;
  };

  const previewCommission = useMemo(() => {
    // For preview we don't know commission_percent from server until load — but estimate at 50% since it's typical; actual is computed server-side.
    const m = asNumber(globalMargin);
    return Math.round(m * 0.5 * 100) / 100;
  }, [globalMargin]);

  const valid = useMemo(() => {
    const area = asNumber(roofArea);
    const gross = asNumber(grossAmount);
    const margin = asNumber(globalMargin);
    const down = asNumber(downPayment);
    return (
      signedAt.length >= 10 &&
      area > 0 &&
      gross > 0 &&
      margin >= 0 &&
      margin <= gross &&
      (financing === "credit" ||
        (financing === "cash" && down >= 0 && down <= gross && asNumber(installments, 1) > 0))
    );
  }, [signedAt, roofArea, grossAmount, globalMargin, financing, downPayment, installments]);

  const submit = async () => {
    if (!valid) {
      Alert.alert(
        "Błąd",
        "Uzupełnij wszystkie wymagane pola z poprawnymi wartościami.\n\n• Marża nie może przekraczać ceny brutto\n• Wpłata własna nie może przekraczać ceny brutto"
      );
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        lead_id: leadId,
        signed_at: signedAt,
        buildings_count: parseInt(buildingsCount) || 1,
        building_type: buildingType,
        roof_area_m2: asNumber(roofArea),
        gross_amount: asNumber(grossAmount),
        global_margin: asNumber(globalMargin),
        financing_type: financing,
        note: note || undefined,
      };
      if (financing === "cash") {
        body.down_payment_amount = asNumber(downPayment);
        body.installments_count = parseInt(installments) || 1;
        body.total_paid_amount = asNumber(downPayment);
      }
      const res = await api.post("/contracts", body, {
        headers: { "Idempotency-Key": idempotencyKey.current },
      });
      Alert.alert(
        "Umowa dodana",
        `Prowizja: ${fmtPln(res.data.commission_amount || 0)}\nStatus: ${
          res.data.status === "frozen" ? `ZAMROŻONA na ${res.data.days_until_release} dni` : res.data.status
        }`,
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (e) {
      Alert.alert("Błąd zapisu", formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const setQuickDate = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    setSignedAt(d.toISOString().slice(0, 10));
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]} testID="contract-form-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()} testID="contract-back">
            <Feather name="arrow-left" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Dodaj umowę</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{clientName || "—"}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <View style={styles.ruleBox}>
            <Feather name="shield" size={14} color={colors.info} />
            <Text style={styles.ruleText}>
              Po zapisie prowizja zostanie <Text style={{ fontWeight: "900" }}>ZAMROŻONA na 14 dni</Text> (prawo odstąpienia). Wartości można zweryfikować w zakładce „Finanse".
            </Text>
          </View>

          <Text style={styles.label}>Data podpisania *</Text>
          <TextInput
            style={styles.input}
            value={signedAt}
            onChangeText={setSignedAt}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textSecondary}
            testID="contract-signed-at"
          />
          <View style={styles.quickRow}>
            <TouchableOpacity style={styles.chip} onPress={() => setQuickDate(-1)}><Text style={styles.chipText}>Wczoraj</Text></TouchableOpacity>
            <TouchableOpacity style={styles.chip} onPress={() => setQuickDate(0)}><Text style={styles.chipText}>Dziś</Text></TouchableOpacity>
          </View>

          <Text style={styles.label}>Typ budynku *</Text>
          <View style={styles.segRow}>
            {(["mieszkalny", "gospodarczy"] as BuildingType[]).map((t) => {
              const active = buildingType === t;
              return (
                <TouchableOpacity
                  key={t}
                  style={[styles.seg, active && styles.segActive]}
                  onPress={() => setBuildingType(t)}
                  testID={`contract-type-${t}`}
                >
                  <Feather name={t === "mieszkalny" ? "home" : "box"} size={14} color={active ? "#fff" : colors.textPrimary} />
                  <Text style={[styles.segText, active && { color: "#fff" }]}>
                    {t === "mieszkalny" ? "Mieszkalny" : "Gospodarczy"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Liczba budynków</Text>
              <TextInput style={styles.input} value={buildingsCount} onChangeText={setBuildingsCount} keyboardType="number-pad" testID="contract-buildings-count" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Metraż dachu (m²) *</Text>
              <TextInput style={styles.input} value={roofArea} onChangeText={setRoofArea} keyboardType="decimal-pad" placeholder="np. 180" placeholderTextColor={colors.textSecondary} testID="contract-roof-area" />
            </View>
          </View>

          <Text style={styles.label}>Cena brutto umowy (PLN) *</Text>
          <TextInput style={styles.input} value={grossAmount} onChangeText={setGrossAmount} keyboardType="decimal-pad" placeholder="np. 65000" placeholderTextColor={colors.textSecondary} testID="contract-gross-amount" />

          <Text style={styles.label}>Marża globalna (PLN) *</Text>
          <TextInput
            style={[styles.input, styles.inputHighlight]}
            value={globalMargin}
            onChangeText={setGlobalMargin}
            keyboardType="decimal-pad"
            placeholder="np. 12000"
            placeholderTextColor={colors.textSecondary}
            testID="contract-global-margin"
          />
          <Text style={styles.hint}>
            Na tej kwocie liczona jest prowizja handlowca. Przybliżenie: ~{fmtPln(previewCommission)} (przy 50%).
            Rzeczywisty % wg ustawień Admina.
          </Text>

          <Text style={styles.label}>Typ finansowania *</Text>
          <View style={styles.segRow}>
            {(["credit", "cash"] as Financing[]).map((f) => {
              const active = financing === f;
              return (
                <TouchableOpacity
                  key={f}
                  style={[styles.seg, active && styles.segActive]}
                  onPress={() => setFinancing(f)}
                  testID={`contract-financing-${f}`}
                >
                  <Feather name={f === "credit" ? "credit-card" : "dollar-sign"} size={14} color={active ? "#fff" : colors.textPrimary} />
                  <Text style={[styles.segText, active && { color: "#fff" }]}>
                    {f === "credit" ? "Kredyt" : "Gotówka"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {financing === "cash" && (
            <>
              <Text style={styles.hint}>
                Przy gotówce w transzach — prowizja zwalniana proporcjonalnie po 14 dniach, wg % opłaconej kwoty.
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Wpłata własna (PLN)</Text>
                  <TextInput style={styles.input} value={downPayment} onChangeText={setDownPayment} keyboardType="decimal-pad" placeholder="np. 20000" placeholderTextColor={colors.textSecondary} testID="contract-down-payment" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Liczba transz</Text>
                  <TextInput style={styles.input} value={installments} onChangeText={setInstallments} keyboardType="number-pad" testID="contract-installments" />
                </View>
              </View>
            </>
          )}

          <Text style={styles.label}>Notatka (opcjonalnie)</Text>
          <TextInput style={[styles.input, { height: 80 }]} value={note} onChangeText={setNote} multiline placeholder="..." placeholderTextColor={colors.textSecondary} testID="contract-note" />

          <TouchableOpacity
            style={[styles.submit, !valid && { opacity: 0.4 }]}
            onPress={submit}
            disabled={!valid || saving}
            testID="contract-submit"
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="check" size={18} color="#fff" />
                <Text style={styles.submitText}>Zapisz umowę (prowizja zamrażana na 14 dni)</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", gap: 12, alignItems: "center", padding: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary },
  ruleBox: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: `${colors.info}10`, padding: 12, borderRadius: radius.md, marginBottom: 12, borderWidth: 1, borderColor: `${colors.info}40` },
  ruleText: { flex: 1, fontSize: 11, color: colors.textPrimary, lineHeight: 16 },
  label: { fontSize: 10, color: colors.textSecondary, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginTop: 14, marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, fontWeight: "700", color: colors.textPrimary, backgroundColor: colors.paper },
  inputHighlight: { borderColor: colors.secondary, backgroundColor: "#F0FDF4" },
  hint: { fontSize: 11, color: colors.textSecondary, marginTop: 4, lineHeight: 15 },
  quickRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.paper },
  chipText: { fontSize: 11, color: colors.textPrimary, fontWeight: "700" },
  segRow: { flexDirection: "row", gap: 8 },
  seg: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.paper },
  segActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segText: { fontSize: 13, fontWeight: "800", color: colors.textPrimary },
  submit: { marginTop: 24, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.secondary, paddingVertical: 16, borderRadius: radius.md },
  submitText: { color: "#fff", fontWeight: "900", fontSize: 14, letterSpacing: 0.3 },
});
