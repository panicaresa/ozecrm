import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, formatApiError } from "../../src/lib/api";
import { colors, radius, spacing } from "../../src/theme";
import { Field } from "../../src/components/Field";
import { Button } from "../../src/components/Button";

export default function AdminSettings() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<any>({});
  const [excludedInput, setExcludedInput] = useState("");
  const [rrsoLabel, setRrsoLabel] = useState("");
  const [rrsoValue, setRrsoValue] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/settings");
        setSettings(res.data);
      } catch (e) {
        Alert.alert("Błąd", formatApiError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = (k: string, v: any) => setSettings((s: any) => ({ ...s, [k]: v }));

  const removeZip = (z: string) =>
    setSettings((s: any) => ({ ...s, excluded_zip_codes: (s.excluded_zip_codes || []).filter((x: string) => x !== z) }));

  const addZip = () => {
    const v = excludedInput.trim();
    if (!v) return;
    setSettings((s: any) => ({ ...s, excluded_zip_codes: [...(s.excluded_zip_codes || []), v] }));
    setExcludedInput("");
  };

  const addRrso = () => {
    const v = parseFloat(rrsoValue);
    if (!rrsoLabel.trim() || !isFinite(v)) return;
    setSettings((s: any) => ({ ...s, rrso_rates: [...(s.rrso_rates || []), { label: rrsoLabel.trim(), value: v }] }));
    setRrsoLabel("");
    setRrsoValue("");
  };

  const removeRrso = (label: string) =>
    setSettings((s: any) => ({ ...s, rrso_rates: (s.rrso_rates || []).filter((r: any) => r.label !== label) }));

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        base_price_low: parseFloat(String(settings.base_price_low || 0)) || 0,
        base_price_high: parseFloat(String(settings.base_price_high || 0)) || 0,
        default_margin: parseFloat(String(settings.default_margin || 0)) || 0,
        default_discount: parseFloat(String(settings.default_discount || 0)) || 0,
        default_subsidy: parseFloat(String(settings.default_subsidy || 0)) || 0,
        default_months: parseInt(String(settings.default_months || 119), 10) || 119,
        commission_percent: parseFloat(String(settings.commission_percent ?? 50)) || 0,
        margin_per_m2: parseFloat(String(settings.margin_per_m2 ?? 50)) || 0,
        rrso_rates: settings.rrso_rates || [],
        excluded_zip_codes: settings.excluded_zip_codes || [],
        company_name: settings.company_name,
        company_address: settings.company_address,
        company_zip: settings.company_zip,
        company_nip: settings.company_nip,
        company_email: settings.company_email,
        company_phone: settings.company_phone,
      };
      await api.put("/settings", body);
      Alert.alert("Zapisano", "Konfiguracja zaktualizowana");
    } catch (e) {
      Alert.alert("Błąd", formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

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
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()} testID="settings-back-button">
            <Feather name="arrow-left" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Ustawienia</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.section}>Ceny bazowe (PLN / m²)</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Field label="≤200 m²" value={String(settings.base_price_low || "")} keyboardType="decimal-pad" onChangeText={(v) => update("base_price_low", v)} testID="admin-price-low" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label=">200 m²" value={String(settings.base_price_high || "")} keyboardType="decimal-pad" onChangeText={(v) => update("base_price_high", v)} testID="admin-price-high" />
            </View>
          </View>

          <Text style={styles.section}>Domyślne kwoty</Text>
          <Field label="Marża globalna" value={String(settings.default_margin || "")} keyboardType="decimal-pad" onChangeText={(v) => update("default_margin", v)} />
          <Field label="Rabat" value={String(settings.default_discount || "")} keyboardType="decimal-pad" onChangeText={(v) => update("default_discount", v)} />
          <Field label="Dotacja" value={String(settings.default_subsidy || "")} keyboardType="decimal-pad" onChangeText={(v) => update("default_subsidy", v)} />
          <Field label="Liczba rat (domyślnie)" value={String(settings.default_months || "")} keyboardType="number-pad" onChangeText={(v) => update("default_months", v)} />

          <Text style={styles.section}>Kalkulator prowizji handlowca</Text>
          <Text style={styles.hint}>
            Parametry używane przez Szybki Kalkulator Prowizji (widget na dashboardach).
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Field
                label="Prowizja (% marży)"
                value={String(settings.commission_percent ?? "")}
                keyboardType="decimal-pad"
                onChangeText={(v) => update("commission_percent", v)}
                placeholder="50"
                testID="admin-commission-percent"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Marża na m² (PLN)"
                value={String(settings.margin_per_m2 ?? "")}
                keyboardType="decimal-pad"
                onChangeText={(v) => update("margin_per_m2", v)}
                placeholder="50"
                testID="admin-margin-per-m2"
              />
            </View>
          </View>

          <Text style={styles.section}>Bankowe RRSO</Text>
          <View style={{ gap: 8 }}>
            {(settings.rrso_rates || []).map((r: any) => (
              <View key={r.label} style={styles.listRow} testID={`rrso-row-${r.label}`}>
                <Text style={styles.listText}><Text style={{ fontWeight: "800" }}>{r.label}</Text> · {r.value}%</Text>
                <TouchableOpacity onPress={() => removeRrso(r.label)}>
                  <Feather name="trash-2" size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <Field label="Nazwa" value={rrsoLabel} onChangeText={setRrsoLabel} placeholder="np. Alior" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="RRSO %" value={rrsoValue} onChangeText={setRrsoValue} keyboardType="decimal-pad" placeholder="8.85" />
            </View>
            <TouchableOpacity style={styles.addBtnSmall} onPress={addRrso} testID="add-rrso-button">
              <Feather name="plus" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          <Text style={styles.section}>Kody pocztowe wykluczone z dotacji</Text>
          <View style={{ gap: 6 }}>
            {(settings.excluded_zip_codes || []).map((z: string) => (
              <View key={z} style={styles.listRow}>
                <Text style={styles.listText}>{z}</Text>
                <TouchableOpacity onPress={() => removeZip(z)}>
                  <Feather name="trash-2" size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <Field label="Dodaj kod" value={excludedInput} onChangeText={setExcludedInput} placeholder="00-000" />
            </View>
            <TouchableOpacity style={styles.addBtnSmall} onPress={addZip} testID="add-zip-button">
              <Feather name="plus" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          <Text style={styles.section}>Dane firmy (nagłówek oferty)</Text>
          <Field label="Nazwa firmy" value={settings.company_name || ""} onChangeText={(v) => update("company_name", v)} />
          <Field label="Adres" value={settings.company_address || ""} onChangeText={(v) => update("company_address", v)} />
          <Field label="Kod i miasto" value={settings.company_zip || ""} onChangeText={(v) => update("company_zip", v)} />
          <Field label="NIP" value={settings.company_nip || ""} onChangeText={(v) => update("company_nip", v)} />
          <Field label="E-mail" value={settings.company_email || ""} onChangeText={(v) => update("company_email", v)} keyboardType="email-address" />
          <Field label="Telefon" value={settings.company_phone || ""} onChangeText={(v) => update("company_phone", v)} keyboardType="phone-pad" />
        </ScrollView>
        <View style={styles.footer}>
          <Button title="Zapisz ustawienia" onPress={save} loading={saving} testID="save-settings-button" icon={<Feather name="save" size={18} color="#fff" />} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", gap: 12, alignItems: "center", padding: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  section: { fontSize: 13, fontWeight: "900", color: colors.textPrimary, textTransform: "uppercase", letterSpacing: 1, marginTop: 16, marginBottom: 8 },
  hint: { fontSize: 12, color: colors.textSecondary, marginBottom: 8, lineHeight: 16 },
  listRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, backgroundColor: colors.paper, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  listText: { color: colors.textPrimary, fontSize: 14 },
  addBtnSmall: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.md, backgroundColor: colors.paper, borderTopWidth: 1, borderTopColor: colors.border },
});
