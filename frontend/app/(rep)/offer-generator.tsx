import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as ImagePicker from "expo-image-picker";
import { colors, radius, spacing } from "../../src/theme";
import { Field } from "../../src/components/Field";
import { Button } from "../../src/components/Button";
import { api, formatApiError } from "../../src/lib/api";
import { useAuth } from "../../src/lib/auth";
import {
  Building,
  calculateOffer,
  fmtPln,
  buildOfferHtml,
  OfferConfig,
} from "../../src/lib/offerEngine";
import { LOGO_PNG_BASE64 } from "../../src/lib/logoBase64";
import { Image } from "react-native";

type Step = 1 | 2 | 3 | 4;

function rid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function OfferGenerator() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [settings, setSettings] = useState<any>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);

  // Client
  const [clientName, setClientName] = useState("");
  const [clientAddress, setClientAddress] = useState("");

  // Buildings
  const [buildings, setBuildings] = useState<Building[]>([
    { id: rid(), name: "Budynek A", type: "mieszkalny", area: 150 },
  ]);

  // Config
  const [basePriceLow, setBasePriceLow] = useState("275");
  const [basePriceHigh, setBasePriceHigh] = useState("200");
  const [margin, setMargin] = useState("10000");
  const [discountEnabled, setDiscountEnabled] = useState(true);
  const [discount, setDiscount] = useState("2000");
  const [subsidyEnabled, setSubsidyEnabled] = useState(true);
  const [subsidy, setSubsidy] = useState("20000");
  const [installments, setInstallments] = useState(true);
  const [months, setMonths] = useState("119");
  const [rrsoIdx, setRrsoIdx] = useState(1); // Santander default
  const [postalCode, setPostalCode] = useState("");
  const [generating, setGenerating] = useState(false);
  const [intro, setIntro] = useState(
    "Szanowni Państwo, dziękujemy za zainteresowanie naszą ofertą wymiany i modernizacji pokrycia dachowego. Nowy dach to nie tylko estetyka — to trwałość budynku, niższe koszty ogrzewania i spokój na kolejne dekady. Poniżej znajdą Państwo kompletny kosztorys wraz z obowiązującymi stawkami VAT oraz — jeśli wybrano tę opcję — symulację finansowania w ramach Eko-Abonamentu."
  );
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/settings");
        setSettings(res.data);
        setBasePriceLow(String(res.data.base_price_low ?? 275));
        setBasePriceHigh(String(res.data.base_price_high ?? 200));
        setMargin(String(res.data.default_margin ?? 10000));
        setDiscount(String(res.data.default_discount ?? 2000));
        setSubsidy(String(res.data.default_subsidy ?? 20000));
        setMonths(String(res.data.default_months ?? 119));
      } catch (e) {
        // continue with defaults
      } finally {
        setSettingsLoading(false);
      }
    })();
  }, []);

  const rrsoRates = settings?.rrso_rates?.length
    ? settings.rrso_rates
    : [
        { label: "Alior", value: 8.85 },
        { label: "Santander", value: 10.75 },
        { label: "Inbank", value: 13.42 },
        { label: "Cofidis", value: 11.9 },
      ];

  const cfg: OfferConfig = useMemo(
    () => ({
      basePriceLow: parseFloat(basePriceLow) || 0,
      basePriceHigh: parseFloat(basePriceHigh) || 0,
      globalMargin: parseFloat(margin) || 0,
      discount: parseFloat(discount) || 0,
      discountEnabled,
      subsidy: parseFloat(subsidy) || 0,
      subsidyEnabled,
      installments,
      months: parseInt(months, 10) || 1,
      rrso: rrsoRates[rrsoIdx]?.value ?? 10.75,
      postalCode,
      excludedZipCodes: settings?.excluded_zip_codes || [],
    }),
    [basePriceLow, basePriceHigh, margin, discount, discountEnabled, subsidy, subsidyEnabled, installments, months, rrsoIdx, postalCode, rrsoRates, settings]
  );

  const totals = useMemo(() => calculateOffer(buildings, cfg), [buildings, cfg]);

  const addBuilding = () => {
    const i = buildings.length;
    setBuildings([...buildings, { id: rid(), name: `Budynek ${String.fromCharCode(65 + i)}`, type: "mieszkalny", area: 100 }]);
  };

  const updateBuilding = (id: string, patch: Partial<Building>) => {
    setBuildings(buildings.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const removeBuilding = (id: string) => {
    if (buildings.length === 1) return;
    setBuildings(buildings.filter((b) => b.id !== id));
  };

  const pickVizPhoto = async (buildingId: string, slot: "before" | "after", src: "camera" | "gallery") => {
    setUploadingFor(`${buildingId}-${slot}`);
    try {
      let res: ImagePicker.ImagePickerResult;
      if (src === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Brak uprawnień", "Włącz kamerę w ustawieniach.");
          return;
        }
        res = await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true, allowsEditing: true, aspect: [4, 3] });
      } else {
        res = await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true, allowsEditing: true, aspect: [4, 3] });
      }
      if (!res.canceled && res.assets?.[0]?.base64) {
        const b64 = `data:${res.assets[0].mimeType || "image/jpeg"};base64,${res.assets[0].base64}`;
        const patch = slot === "before" ? { beforeBase64: b64 } : { afterBase64: b64 };
        updateBuilding(buildingId, patch);
      }
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się wybrać zdjęcia");
    } finally {
      setUploadingFor(null);
    }
  };

  const offerVizPicker = (buildingId: string, slot: "before" | "after") =>
    Alert.alert(slot === "before" ? "Stan obecny" : "Wizualizacja po", "Wybierz źródło zdjęcia", [
      { text: "Anuluj", style: "cancel" },
      { text: "Aparat", onPress: () => pickVizPhoto(buildingId, slot, "camera") },
      { text: "Galeria", onPress: () => pickVizPhoto(buildingId, slot, "gallery") },
    ]);

  const generatePdf = async () => {
    if (!clientName.trim()) {
      Alert.alert("Brak danych", "Uzupełnij dane klienta przed wygenerowaniem oferty.");
      setStep(1);
      return;
    }
    setGenerating(true);
    try {
      const html = buildOfferHtml({
        buildings,
        totals,
        cfg,
        client: { name: clientName, address: clientAddress },
        author: user?.name || "—",
        validity: "14 dni",
        company: {
          name: settings?.company_name || "Polska Grupa OZE Sp. z o.o.",
          address: settings?.company_address || "ul. Grunwaldzka 415",
          zip: settings?.company_zip || "80-309 Gdańsk",
          nip: settings?.company_nip || "NIP: 732-219-77-56",
          email: settings?.company_email || "biuro@grupaoze.pl",
          phone: settings?.company_phone || "+48 509-274-365",
        },
        rrsoLabel: `${rrsoRates[rrsoIdx]?.label || "Bank"} RRSO ${rrsoRates[rrsoIdx]?.value}%`,
        intro,
        logoDataUrl: LOGO_PNG_BASE64,
        logoRemoteUrl: "https://grupaoze.pl/wp-content/uploads/2025/12/x1.png.pagespeed.ic.FHpTwhhqvK.webp",
      });

      if (Platform.OS === "web") {
        const win = (globalThis as any).window;
        const w = win?.open("", "_blank");
        if (w) {
          w.document.write(html);
          w.document.close();
        } else {
          Alert.alert("Podgląd PDF", "Odblokuj wyskakujące okienka przeglądarki, aby zobaczyć podgląd.");
        }
      } else {
        const file = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle: "Oferta OZE" });
        } else {
          Alert.alert("PDF zapisany", file.uri);
        }
      }
    } catch (e: any) {
      Alert.alert("Błąd PDF", e?.message || "Nie udało się wygenerować pliku");
    } finally {
      setGenerating(false);
    }
  };

  if (settingsLoading) {
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
          <TouchableOpacity style={styles.back} onPress={() => router.back()} testID="offer-back-button">
            <Feather name="arrow-left" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Generator ofert OZE</Text>
            <Text style={styles.sub}>Krok {step} z 4</Text>
          </View>
        </View>

        <View style={styles.stepper}>
          {[1, 2, 3, 4].map((n) => (
            <View key={n} style={[styles.stepDot, step >= n && styles.stepDotActive]} />
          ))}
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 220 }} keyboardShouldPersistTaps="handled">
          {step === 1 && (
            <>
              <Text style={styles.stepTitle}>1. Dane klienta</Text>
              <Field label="Klient" placeholder="Imię i nazwisko / firma" value={clientName} onChangeText={setClientName} testID="offer-client-name" />
              <Field label="Adres inwestycji" placeholder="Ulica, miasto" value={clientAddress} onChangeText={setClientAddress} testID="offer-client-address" />
              <Field
                label="Kod pocztowy (weryfikacja dotacji)"
                placeholder="00-000"
                value={postalCode}
                onChangeText={setPostalCode}
                testID="offer-postal-code"
              />
              {postalCode.trim().length >= 5 && (
                <View style={[styles.note, totals.isSubsidyExcluded ? styles.noteErr : styles.noteOk]}>
                  <Feather
                    name={totals.isSubsidyExcluded ? "x-circle" : "check-circle"}
                    size={16}
                    color={totals.isSubsidyExcluded ? colors.error : colors.success}
                  />
                  <Text style={[styles.noteText, { color: totals.isSubsidyExcluded ? colors.error : colors.success }]}>
                    {totals.isSubsidyExcluded
                      ? "Kod wykluczony z dotacji regionalnej"
                      : "Kod kwalifikuje się do dotacji"}
                  </Text>
                </View>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.stepTitle}>2. Obiekty</Text>
              {buildings.map((b, idx) => (
                <View key={b.id} style={styles.buildingCard} testID={`building-card-${idx}`}>
                  <View style={styles.buildingHead}>
                    <Text style={styles.buildingName}>{b.name}</Text>
                    {buildings.length > 1 && (
                      <TouchableOpacity onPress={() => removeBuilding(b.id)} testID={`remove-building-${idx}`}>
                        <Feather name="trash-2" size={16} color={colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <Field
                    label="Nazwa"
                    value={b.name}
                    onChangeText={(v) => updateBuilding(b.id, { name: v })}
                    testID={`building-name-${idx}`}
                  />
                  <Text style={styles.sectionLabel}>Typ obiektu</Text>
                  <View style={styles.pills}>
                    {(["mieszkalny", "gospodarczy"] as const).map((t) => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.pill, b.type === t && styles.pillActive]}
                        onPress={() => updateBuilding(b.id, { type: t })}
                        testID={`building-type-${idx}-${t}`}
                      >
                        <Text style={[styles.pillText, b.type === t && styles.pillTextActive]}>
                          {t === "mieszkalny" ? "Mieszkalny" : "Gospodarczy"}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Field
                    label="Metraż (m²)"
                    value={String(b.area)}
                    keyboardType="decimal-pad"
                    onChangeText={(v) => updateBuilding(b.id, { area: parseFloat(v.replace(",", ".")) || 0 })}
                    testID={`building-area-${idx}`}
                  />
                  <View style={styles.vatBadge}>
                    <Text style={styles.vatBadgeText}>
                      VAT: {
                        b.type === "gospodarczy"
                          ? "23%"
                          : b.area <= 300
                          ? "8%"
                          : "Mieszany proporcjonalny (pow. 300 m²)"
                      }
                    </Text>
                  </View>

                  <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Wizualizacje (opcjonalnie)</Text>
                  <Text style={styles.vizHelp}>Wgraj zdjęcie "przed" i "po" — pojawią się obok siebie w PDF nad kosztorysem.</Text>
                  <View style={styles.vizRow}>
                    {(["before", "after"] as const).map((slot) => {
                      const img = slot === "before" ? b.beforeBase64 : b.afterBase64;
                      const busy = uploadingFor === `${b.id}-${slot}`;
                      return (
                        <TouchableOpacity
                          key={slot}
                          style={styles.vizTile}
                          activeOpacity={0.8}
                          onPress={() => offerVizPicker(b.id, slot)}
                          testID={`viz-${slot}-${idx}`}
                          disabled={busy}
                        >
                          {img ? (
                            <Image source={{ uri: img }} style={styles.vizImg} resizeMode="cover" />
                          ) : (
                            <View style={styles.vizEmpty}>
                              {busy ? (
                                <ActivityIndicator color={colors.primary} size="small" />
                              ) : (
                                <>
                                  <Feather name={slot === "before" ? "camera" : "image"} size={24} color={colors.textSecondary} />
                                  <Text style={styles.vizEmptyText}>Dodaj zdjęcie</Text>
                                </>
                              )}
                            </View>
                          )}
                          <View style={[styles.vizCap, { backgroundColor: slot === "before" ? "#64748B" : colors.primary }]}>
                            <Text style={styles.vizCapText}>
                              {slot === "before" ? "Stan obecny" : "Wizualizacja po"}
                            </Text>
                          </View>
                          {img && (
                            <TouchableOpacity
                              style={styles.vizClear}
                              onPress={() => updateBuilding(b.id, slot === "before" ? { beforeBase64: null } : { afterBase64: null })}
                              testID={`viz-clear-${slot}-${idx}`}
                            >
                              <Feather name="x" size={12} color="#fff" />
                            </TouchableOpacity>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
              <TouchableOpacity style={styles.addBtn} onPress={addBuilding} testID="add-building-button" activeOpacity={0.8}>
                <Feather name="plus" size={18} color={colors.primary} />
                <Text style={styles.addBtnText}>Dodaj kolejny obiekt</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 3 && (
            <>
              <Text style={styles.stepTitle}>3. Parametry finansowe</Text>
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Field label="Cena bazowa ≤200 m²" value={basePriceLow} onChangeText={setBasePriceLow} keyboardType="decimal-pad" testID="price-low" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Cena bazowa >200 m²" value={basePriceHigh} onChangeText={setBasePriceHigh} keyboardType="decimal-pad" testID="price-high" />
                </View>
              </View>
              <Field label="Marża globalna (PLN)" value={margin} onChangeText={setMargin} keyboardType="decimal-pad" testID="margin-input" />

              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Rabat</Text>
                <TouchableOpacity
                  style={[styles.toggle, discountEnabled && styles.toggleOn]}
                  onPress={() => setDiscountEnabled((v) => !v)}
                  testID="toggle-discount"
                >
                  <View style={[styles.toggleKnob, discountEnabled && styles.toggleKnobOn]} />
                </TouchableOpacity>
              </View>
              {discountEnabled && (
                <Field label="Kwota rabatu (PLN)" value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" testID="discount-input" />
              )}

              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Dotacja</Text>
                <TouchableOpacity
                  style={[styles.toggle, subsidyEnabled && styles.toggleOn]}
                  onPress={() => setSubsidyEnabled((v) => !v)}
                  testID="toggle-subsidy"
                >
                  <View style={[styles.toggleKnob, subsidyEnabled && styles.toggleKnobOn]} />
                </TouchableOpacity>
              </View>
              {subsidyEnabled && (
                <Field label="Kwota dotacji (PLN)" value={subsidy} onChangeText={setSubsidy} keyboardType="decimal-pad" testID="subsidy-input" />
              )}

              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Raty (Eko-Abonament)</Text>
                <TouchableOpacity
                  style={[styles.toggle, installments && styles.toggleOn]}
                  onPress={() => setInstallments((v) => !v)}
                  testID="toggle-installments"
                >
                  <View style={[styles.toggleKnob, installments && styles.toggleKnobOn]} />
                </TouchableOpacity>
              </View>

              {installments && (
                <>
                  <Field label="Liczba miesięcy" value={months} onChangeText={setMonths} keyboardType="number-pad" testID="months-input" />
                  <Text style={styles.sectionLabel}>Bank / RRSO</Text>
                  <View style={styles.pills}>
                    {rrsoRates.map((r: any, i: number) => (
                      <TouchableOpacity
                        key={r.label}
                        style={[styles.pill, rrsoIdx === i && styles.pillActive]}
                        onPress={() => setRrsoIdx(i)}
                        testID={`rrso-${r.label.toLowerCase()}`}
                      >
                        <Text style={[styles.pillText, rrsoIdx === i && styles.pillTextActive]}>
                          {r.label} · {r.value}%
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <Text style={styles.stepTitle}>4. Podsumowanie</Text>

              <Text style={styles.sectionLabel}>Tekst wstępny oferty (edytowalny)</Text>
              <Field
                placeholder="Tekst wstępny, który pojawi się w PDF…"
                value={intro}
                onChangeText={setIntro}
                multiline
                numberOfLines={6}
                style={{ height: 140, textAlignVertical: "top" }}
                testID="offer-intro-textarea"
              />

              <View style={styles.summaryCard}>
                <SummaryRow label="Klient" value={clientName || "—"} />
                <SummaryRow label="Adres" value={clientAddress || "—"} />
                <SummaryRow label="Łączny metraż" value={`${totals.totalArea} m²`} />
                <SummaryRow label="Cena za m² (+marża)" value={`${fmtPln(totals.baseRatePerM2 + totals.marginPerM2)}`} />
                <View style={styles.divider} />
                <SummaryRow label="Netto" value={fmtPln(totals.netTotal)} />
                <SummaryRow label={totals.vatSummaryLabel} value={fmtPln(totals.vatTotal)} />
                <SummaryRow label="Brutto" value={fmtPln(totals.grossTotal)} bold />
                {cfg.discountEnabled && <SummaryRow label="Rabat" value={`− ${fmtPln(cfg.discount)}`} />}
                {cfg.subsidyEnabled && <SummaryRow label="Dotacja" value={`− ${fmtPln(cfg.subsidy)}`} />}
                {(cfg.discountEnabled || cfg.subsidyEnabled) && (
                  <SummaryRow label="Koszt końcowy" value={fmtPln(totals.finalCost)} bold accent={colors.primary} />
                )}
                {cfg.installments && totals.monthlyInstallment !== null && (
                  <SummaryRow
                    label={`Rata mies. (${rrsoRates[rrsoIdx]?.label} ${rrsoRates[rrsoIdx]?.value}%, ${cfg.months} m-cy)`}
                    value={`${fmtPln(totals.monthlyInstallment)}/mc`}
                    accent={colors.primary}
                    bold
                  />
                )}
                {totals.isSubsidyExcluded && (
                  <Text style={{ color: colors.error, fontSize: 12, marginTop: 8 }}>
                    ⚠ Kod pocztowy {cfg.postalCode} jest wykluczony z dotacji
                  </Text>
                )}
              </View>
            </>
          )}
        </ScrollView>

        {/* Sticky totals footer + actions */}
        <View style={styles.footer}>
          <View style={styles.footerTotals}>
            <View>
              <Text style={styles.footerLabel}>DO ZAPŁATY</Text>
              <Text style={styles.footerGross}>
                {fmtPln(cfg.subsidyEnabled || cfg.discountEnabled ? totals.finalCost : totals.grossTotal)}
              </Text>
            </View>
            {cfg.installments && totals.monthlyInstallment !== null && (
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.footerLabel}>RATA / MC</Text>
                <Text style={styles.footerRate}>{fmtPln(totals.monthlyInstallment)}</Text>
              </View>
            )}
          </View>
          <View style={styles.navRow}>
            {step > 1 && (
              <Button
                title="Wstecz"
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => setStep((s) => (s - 1) as Step)}
                testID="step-back-button"
              />
            )}
            {step < 4 ? (
              <Button
                title={step === 3 ? "Podsumowanie" : "Dalej"}
                variant="primary"
                style={{ flex: 1 }}
                onPress={() => setStep((s) => (s + 1) as Step)}
                icon={<Feather name="arrow-right" size={18} color="#fff" />}
                testID="step-next-button"
              />
            ) : (
              <Button
                title="Generuj PDF"
                variant="primary"
                style={{ flex: 1 }}
                onPress={generatePdf}
                loading={generating}
                icon={<Feather name="file-text" size={18} color="#fff" />}
                testID="generate-pdf-button"
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const SummaryRow: React.FC<{ label: string; value: string; bold?: boolean; accent?: string }> = ({ label, value, bold, accent }) => (
  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
    <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1, flexWrap: "wrap", marginRight: 8 }}>{label}</Text>
    <Text style={{ color: accent || colors.textPrimary, fontSize: bold ? 16 : 13, fontWeight: bold ? "900" : "600" }}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.md, paddingBottom: 4 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  sub: { fontSize: 11, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 1 },
  stepper: { flexDirection: "row", gap: 8, paddingHorizontal: spacing.md, paddingTop: 8 },
  stepDot: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.zinc200 },
  stepDotActive: { backgroundColor: colors.primary },
  stepTitle: { fontSize: 18, fontWeight: "900", color: colors.textPrimary, marginBottom: spacing.md },
  buildingCard: { backgroundColor: colors.paper, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  buildingHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  buildingName: { fontSize: 15, fontWeight: "900", color: colors.textPrimary },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.textPrimary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.md },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.paper },
  pillActive: { backgroundColor: colors.inverted, borderColor: colors.inverted },
  pillText: { fontSize: 12, fontWeight: "700", color: colors.textPrimary },
  pillTextActive: { color: "#fff" },
  vatBadge: { backgroundColor: `${colors.primary}22`, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, alignSelf: "flex-start" },
  vatBadgeText: { fontSize: 11, color: colors.primary, fontWeight: "800", letterSpacing: 0.5 },
  vizHelp: { fontSize: 11, color: colors.textSecondary, marginBottom: 8, marginTop: -4 },
  vizRow: { flexDirection: "row", gap: 10, marginBottom: 8 },
  vizTile: { flex: 1, aspectRatio: 4 / 3, borderRadius: radius.md, overflow: "hidden", borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bg, position: "relative" },
  vizImg: { width: "100%", height: "100%" },
  vizEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  vizEmptyText: { color: colors.textSecondary, fontSize: 11, fontWeight: "600" },
  vizCap: { position: "absolute", bottom: 0, left: 0, right: 0, paddingVertical: 5, paddingHorizontal: 6 },
  vizCapText: { color: "#fff", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, textAlign: "center" },
  vizClear: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(239,68,68,0.92)", alignItems: "center", justifyContent: "center" },
  addBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: radius.md, borderWidth: 2, borderStyle: "dashed", borderColor: colors.primary },
  addBtnText: { color: colors.primary, fontWeight: "800", fontSize: 14 },
  row2: { flexDirection: "row", gap: 8 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.paper, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  toggleLabel: { fontWeight: "700", color: colors.textPrimary, fontSize: 14 },
  toggle: { width: 50, height: 28, borderRadius: 14, backgroundColor: colors.zinc300, padding: 2 },
  toggleOn: { backgroundColor: colors.primary },
  toggleKnob: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#fff" },
  toggleKnobOn: { transform: [{ translateX: 22 }] },
  summaryCard: { backgroundColor: colors.paper, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  note: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radius.md },
  noteOk: { backgroundColor: `${colors.success}15` },
  noteErr: { backgroundColor: `${colors.error}15` },
  noteText: { fontSize: 12, fontWeight: "600" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.paper, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, gap: 12 },
  footerTotals: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  footerLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: "700", letterSpacing: 1 },
  footerGross: { fontSize: 22, fontWeight: "900", color: colors.textPrimary, letterSpacing: -0.5 },
  footerRate: { fontSize: 18, fontWeight: "900", color: colors.primary },
  navRow: { flexDirection: "row", gap: 8 },
});
