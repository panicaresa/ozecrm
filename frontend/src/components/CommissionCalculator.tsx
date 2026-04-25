import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import { api, formatApiError } from "../lib/api";
import { fmtPln } from "../lib/offerEngine";

// ──────────────────────────────────────────────────────────────────────────────
// Szybki Kalkulator Prowizji (Sprint 3.5b)
// ALIGNED with POST /api/contracts (Sprint 4.5): user inputs the GROSS PRICE
// (what the client pays), and the system derives firm_cost, margin and
// commission — never the other way around. This matches what the handlowiec
// will actually type into the contract form (/add-contract).
// ──────────────────────────────────────────────────────────────────────────────

type BuildingType = "mieszkalny" | "gospodarczy";

interface Props {
  testID?: string;
  compact?: boolean;
}

interface Settings {
  commission_percent?: number;
  base_price_low?: number;
  base_price_high?: number;
}

interface Result {
  area: number;
  basePricePerM2: number;
  firmCost: number;
  grossInput: number | null; // null when the user hasn't entered a price yet
  gross: number; // effective gross used for the math (suggested fallback if no input)
  suggestedGross: number; // koszt * 1.3 — only shown as hint
  usingSuggested: boolean;
  marginNetto: number;
  marginPctOfCost: number;
  vatAmount: number;
  vatLabel: "8%" | "23%" | "Mieszany";
  totalBrutto: number;
  commission: number;
  commissionPercent: number;
  isNegative: boolean;
  isHighMargin: boolean;
}

const SUGGESTED_MULTIPLIER = 1.3; // koszt + ~30% ≈ przykładowa cena oferty

function computeAll(
  area: number,
  type: BuildingType,
  grossPriceInput: number | null,
  cfg: { commissionPercent: number; basePriceLow: number; basePriceHigh: number }
): Result {
  const safeArea = isFinite(area) && area > 0 ? area : 0;
  // MATCHES backend _compute_cost_and_margin: ≥200m² → base_high, <200m² → base_low
  const basePricePerM2 = safeArea >= 200 ? cfg.basePriceHigh : cfg.basePriceLow;
  const firmCost = Math.round(safeArea * basePricePerM2 * 100) / 100;

  const suggestedGross = Math.round(firmCost * SUGGESTED_MULTIPLIER * 100) / 100;

  const hasInput =
    grossPriceInput != null && isFinite(grossPriceInput) && grossPriceInput > 0;
  const gross = hasInput ? (grossPriceInput as number) : suggestedGross;

  // Marża = cena brutto klienta − firm_cost (spójne z POST /contracts)
  const marginNetto = Math.round((gross - firmCost) * 100) / 100;
  const marginPctOfCost =
    firmCost > 0 ? Math.round((marginNetto / firmCost) * 10000) / 100 : 0;

  // VAT — liczony na cenie brutto (sam w sobie traktujemy `gross` jak cenę netto
  // i dodajemy VAT nad nim — zgodnie z dotychczasową logiką POS/oferty).
  let vatAmount = 0;
  let vatLabel: Result["vatLabel"] = "23%";
  if (type === "gospodarczy") {
    vatAmount = gross * 0.23;
    vatLabel = "23%";
  } else if (safeArea <= 300 || safeArea <= 0) {
    vatAmount = gross * 0.08;
    vatLabel = "8%";
  } else {
    const f8 = 300 / safeArea;
    const f23 = (safeArea - 300) / safeArea;
    vatAmount = gross * f8 * 0.08 + gross * f23 * 0.23;
    vatLabel = "Mieszany";
  }
  vatAmount = Math.round(vatAmount * 100) / 100;
  const totalBrutto = Math.round((gross + vatAmount) * 100) / 100;

  const commission =
    Math.round(((cfg.commissionPercent / 100) * Math.max(0, marginNetto)) * 100) / 100;

  return {
    area: safeArea,
    basePricePerM2,
    firmCost,
    grossInput: hasInput ? (grossPriceInput as number) : null,
    gross,
    suggestedGross,
    usingSuggested: !hasInput,
    marginNetto,
    marginPctOfCost,
    vatAmount,
    vatLabel,
    totalBrutto,
    commission,
    commissionPercent: cfg.commissionPercent,
    isNegative: marginNetto < 0,
    isHighMargin: marginPctOfCost >= 50.0,
  };
}

export function CommissionCalculator({ testID, compact = false }: Props) {
  // Sprint 5-pre-bis (ISSUE-UX-003): default to COLLAPSED so the calculator
  // stops occupying scarce top real-estate on every dashboard. User taps
  // the header to expand. Toggle handler at line 200-224 already wired.
  const [expanded, setExpanded] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [areaText, setAreaText] = useState("150");
  const [type, setType] = useState<BuildingType>("mieszkalny");
  const [grossText, setGrossText] = useState<string>(""); // empty → use suggested fallback

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.get("/settings");
        if (!mounted) return;
        setSettings({
          commission_percent:
            typeof res.data?.commission_percent === "number"
              ? res.data.commission_percent
              : 50,
          base_price_low:
            typeof res.data?.base_price_low === "number" ? res.data.base_price_low : 275,
          base_price_high:
            typeof res.data?.base_price_high === "number"
              ? res.data.base_price_high
              : 200,
        });
      } catch (e) {
        if (!mounted) return;
        setErr(formatApiError(e));
        setSettings({ commission_percent: 50, base_price_low: 275, base_price_high: 200 });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const area = useMemo(() => {
    const n = parseFloat((areaText || "").replace(",", "."));
    return isFinite(n) ? n : 0;
  }, [areaText]);

  const grossInput = useMemo(() => {
    const v = parseFloat((grossText || "").replace(",", "."));
    return isFinite(v) && v > 0 ? v : null;
  }, [grossText]);

  const result = useMemo(() => {
    return computeAll(area, type, grossInput, {
      commissionPercent: settings?.commission_percent ?? 50,
      basePriceLow: settings?.base_price_low ?? 275,
      basePriceHigh: settings?.base_price_high ?? 200,
    });
  }, [area, type, grossInput, settings]);

  const fillSuggested = () => {
    setGrossText(String(result.suggestedGross.toFixed(0)));
  };

  const vatTone =
    result.vatLabel === "8%"
      ? { bg: "#DCFCE7", fg: "#166534" }
      : result.vatLabel === "23%"
      ? { bg: "#FEE2E2", fg: "#991B1B" }
      : { bg: "#E0F2FE", fg: "#0369A1" };

  // Margin-state tone (green/amber/red)
  const marginTone = result.isNegative
    ? { bg: `${colors.error}15`, fg: colors.error, label: "MARŻA UJEMNA" }
    : result.isHighMargin
    ? { bg: `${colors.secondary}15`, fg: colors.secondary, label: "WYSOKA MARŻA" }
    : { bg: colors.zinc100, fg: colors.textSecondary, label: "" };

  return (
    <View style={styles.wrap} testID={testID}>
      <TouchableOpacity
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.8}
        style={styles.head}
        testID={testID ? `${testID}-toggle` : "commission-toggle"}
      >
        <View style={styles.headIcon}>
          <Feather name="trending-up" size={16} color={colors.secondary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Szybki kalkulator prowizji</Text>
          <Text style={styles.subtitle}>
            {loading
              ? "ładowanie..."
              : `${result.commissionPercent}% marży · baza ${fmtPln(
                  result.basePricePerM2
                )}/m²`}
          </Text>
        </View>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          {loading ? (
            <View style={{ padding: spacing.md, alignItems: "center" }}>
              <ActivityIndicator color={colors.secondary} />
            </View>
          ) : (
            <>
              {err && <Text style={styles.err}>{err}</Text>}

              {/* Type selector */}
              <Text style={styles.label}>Typ budynku</Text>
              <View style={styles.segRow}>
                {(
                  [
                    {
                      key: "mieszkalny",
                      label: "Mieszkalny",
                      icon: "home" as const,
                      hint: "VAT 8%",
                    },
                    {
                      key: "gospodarczy",
                      label: "Gospodarczy",
                      icon: "box" as const,
                      hint: "VAT 23%",
                    },
                  ] as const
                ).map((o) => {
                  const active = type === o.key;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[styles.seg, active && styles.segActive]}
                      activeOpacity={0.85}
                      onPress={() => setType(o.key)}
                      testID={`commission-type-${o.key}`}
                    >
                      <Feather
                        name={o.icon}
                        size={14}
                        color={active ? "#fff" : colors.textPrimary}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.segText, active && { color: "#fff" }]}>
                          {o.label}
                        </Text>
                        <Text
                          style={[styles.segHint, active && { color: "#DBEAFE" }]}
                        >
                          {o.hint}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Area */}
              <Text style={[styles.label, { marginTop: 10 }]}>
                Powierzchnia dachu
              </Text>
              <View style={styles.areaRow}>
                <View style={styles.areaInputWrap}>
                  <TextInput
                    style={styles.areaInput}
                    value={areaText}
                    onChangeText={setAreaText}
                    keyboardType="decimal-pad"
                    placeholder="150"
                    placeholderTextColor={colors.textSecondary}
                    testID="commission-area-input"
                  />
                  <Text style={styles.areaUnit}>m²</Text>
                </View>
                <View style={styles.chipsRow}>
                  {[100, 150, 200, 300].map((v) => (
                    <TouchableOpacity
                      key={v}
                      style={[styles.chip, area === v && styles.chipActive]}
                      onPress={() => setAreaText(String(v))}
                      testID={`commission-area-chip-${v}`}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          area === v && { color: "#fff" },
                        ]}
                      >
                        {v}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Gross price input — the source of truth now */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 12,
                }}
              >
                <Text style={[styles.label, { marginTop: 0, marginBottom: 0 }]}>
                  Cena dla klienta (netto)
                </Text>
                <TouchableOpacity
                  onPress={fillSuggested}
                  style={styles.suggestBtn}
                  testID="commission-gross-suggest"
                  accessibilityLabel="Wpisz sugerowaną cenę"
                >
                  <Feather name="zap" size={11} color={colors.primary} />
                  <Text style={styles.suggestText}>SUGEROWANA</Text>
                </TouchableOpacity>
              </View>
              <View
                style={[
                  styles.priceInputWrap,
                  result.isNegative && {
                    borderColor: colors.error,
                    backgroundColor: `${colors.error}08`,
                  },
                ]}
              >
                <TextInput
                  style={styles.areaInput}
                  value={grossText}
                  onChangeText={setGrossText}
                  keyboardType="decimal-pad"
                  placeholder={String(result.suggestedGross.toFixed(0))}
                  placeholderTextColor={colors.textSecondary}
                  testID="commission-gross-input"
                />
                <Text style={styles.areaUnit}>PLN</Text>
              </View>
              <Text style={styles.hint}>
                {result.usingSuggested
                  ? `Brak wpisu — używam sugerowanej ceny (koszt + 30%) = `
                  : `Sugerowana (koszt + 30%): `}
                <Text style={{ fontWeight: "800" }}>
                  {fmtPln(result.suggestedGross)}
                </Text>
              </Text>

              {/* Full breakdown */}
              <View
                style={[styles.breakdown, compact && { paddingHorizontal: 10 }]}
              >
                <View style={styles.breakRow}>
                  <Text style={styles.breakLabel}>
                    Stawka firmy ({area >= 200 ? "≥200 m²" : "<200 m²"})
                  </Text>
                  <Text style={styles.breakValue}>
                    {fmtPln(result.basePricePerM2)}/m²
                  </Text>
                </View>
                <View style={styles.breakRow}>
                  <Text style={styles.breakLabel}>
                    Koszt firmy ({fmtPln(result.basePricePerM2)}/m² ×{" "}
                    {result.area} m²)
                  </Text>
                  <Text style={[styles.breakValue, { color: colors.inverted }]}>
                    {fmtPln(result.firmCost)}
                  </Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.breakRow}>
                  <Text
                    style={[
                      styles.breakLabel,
                      { fontWeight: "800", color: colors.textPrimary },
                    ]}
                  >
                    Cena dla klienta
                  </Text>
                  <Text style={[styles.breakValue, { fontSize: 14 }]}>
                    {fmtPln(result.gross)}
                  </Text>
                </View>
                <View style={styles.breakRow}>
                  <View
                    style={{
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Text style={styles.breakLabel}>Marża firmy</Text>
                    {marginTone.label ? (
                      <View style={[styles.vatBadge, { backgroundColor: marginTone.bg }]}>
                        <Text
                          style={{ fontSize: 9, fontWeight: "900", color: marginTone.fg }}
                        >
                          {marginTone.label}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text
                    style={[
                      styles.breakValue,
                      {
                        color: result.isNegative
                          ? colors.error
                          : colors.secondary,
                      },
                    ]}
                    testID="commission-margin-value"
                  >
                    {fmtPln(result.marginNetto)}
                    {result.firmCost > 0 ? (
                      <Text style={styles.breakValueMuted}>
                        {" "}
                        · {result.marginPctOfCost.toFixed(1)}% kosztu
                      </Text>
                    ) : null}
                  </Text>
                </View>
                <View style={styles.breakRow}>
                  <View
                    style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}
                  >
                    <Text style={styles.breakLabel}>VAT</Text>
                    <View style={[styles.vatBadge, { backgroundColor: vatTone.bg }]}>
                      <Text
                        style={{ fontSize: 10, fontWeight: "900", color: vatTone.fg }}
                      >
                        {result.vatLabel}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.breakValueMuted}>
                    + {fmtPln(result.vatAmount)}
                  </Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.breakRow}>
                  <Text
                    style={[
                      styles.breakLabel,
                      { fontWeight: "900", color: colors.inverted, fontSize: 13 },
                    ]}
                  >
                    Cena brutto
                  </Text>
                  <Text
                    style={[styles.breakValue, { fontSize: 16, color: colors.inverted }]}
                    testID="commission-brutto"
                  >
                    {fmtPln(result.totalBrutto)}
                  </Text>
                </View>
              </View>

              {/* Negative margin warning */}
              {result.isNegative && (
                <View style={styles.negativeWarn} testID="commission-negative-warn">
                  <Feather name="alert-octagon" size={14} color={colors.error} />
                  <Text style={styles.negativeWarnText}>
                    Cena dla klienta jest niższa niż koszt firmy. Umowa zablokowana
                    dla handlowca (manager / admin może nadpisać).
                  </Text>
                </View>
              )}

              {/* Commission highlight */}
              <View
                style={[
                  styles.commissionCard,
                  result.isNegative && { backgroundColor: colors.textSecondary },
                ]}
                testID="commission-result"
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.commissionCap}>Prowizja handlowca</Text>
                  <Text style={styles.commissionHint}>
                    {result.commissionPercent}% ×{" "}
                    {fmtPln(Math.max(0, result.marginNetto))}
                    {result.isNegative ? " (marża ujemna → 0)" : ""}
                  </Text>
                </View>
                <Text
                  style={styles.commissionAmount}
                  testID="commission-amount"
                >
                  {fmtPln(result.commission)}
                </Text>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  headIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: `${colors.secondary}20`,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 15,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  subtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  body: {
    padding: spacing.md,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: colors.zinc100,
  },
  label: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 6,
  },
  hint: { fontSize: 11, color: colors.textSecondary, marginTop: 4, lineHeight: 14 },
  segRow: { flexDirection: "row", gap: 8 },
  seg: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  segActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segText: { fontSize: 13, fontWeight: "800", color: colors.textPrimary },
  segHint: { fontSize: 9, color: colors.textSecondary, marginTop: 1, fontWeight: "700" },
  areaRow: { gap: 10 },
  areaInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    backgroundColor: colors.bg,
  },
  priceInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    backgroundColor: `${colors.primary}08`,
  },
  areaInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  areaUnit: { fontSize: 13, color: colors.textSecondary, fontWeight: "700" },
  chipsRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: "800", color: colors.textPrimary },
  suggestBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: `${colors.primary}15`,
  },
  suggestText: { fontSize: 9, fontWeight: "900", color: colors.primary, letterSpacing: 1 },
  breakdown: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 12,
    gap: 6,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  breakRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  breakLabel: { flex: 1, fontSize: 12, color: colors.textSecondary },
  breakValue: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  breakValueMuted: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textSecondary,
    fontVariant: ["tabular-nums"],
  },
  vatBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  negativeWarn: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    marginTop: 10,
    borderRadius: radius.sm,
    backgroundColor: `${colors.error}10`,
    borderWidth: 1,
    borderColor: `${colors.error}40`,
  },
  negativeWarnText: {
    flex: 1,
    color: colors.error,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  commissionCard: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.secondary,
    padding: 14,
    borderRadius: radius.md,
  },
  commissionCap: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  commissionHint: { color: "#F0FDF4", fontSize: 11, marginTop: 2, fontWeight: "600" },
  commissionAmount: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  err: { color: colors.error, fontSize: 12, marginTop: 8 },
});
