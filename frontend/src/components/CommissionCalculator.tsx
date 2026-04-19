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

type BuildingType = "mieszkalny" | "gospodarczy";

interface Props {
  testID?: string;
  compact?: boolean;
}

interface Settings {
  commission_percent?: number;
  margin_per_m2?: number;
  base_price_low?: number;
  base_price_high?: number;
}

interface Result {
  area: number;
  basePricePerM2: number;
  baseNetto: number;
  marginNetto: number;
  marginAutoDefault: number;
  totalNetto: number;
  vatAmount: number;
  vatLabel: "8%" | "23%" | "Mieszany";
  totalBrutto: number;
  commission: number;
  commissionPercent: number;
  marginPerM2: number;
}

function computeAll(
  area: number,
  type: BuildingType,
  marginNettoOverride: number | null,
  cfg: { commissionPercent: number; marginPerM2: number; basePriceLow: number; basePriceHigh: number }
): Result {
  const safeArea = isFinite(area) && area > 0 ? area : 0;
  const basePricePerM2 = safeArea <= 200 ? cfg.basePriceLow : cfg.basePriceHigh;
  const baseNetto = Math.round(safeArea * basePricePerM2 * 100) / 100;

  const marginAutoDefault = Math.round(safeArea * cfg.marginPerM2 * 100) / 100;
  const marginNetto =
    marginNettoOverride != null && isFinite(marginNettoOverride) && marginNettoOverride >= 0
      ? Math.round(marginNettoOverride * 100) / 100
      : marginAutoDefault;

  const totalNetto = Math.round((baseNetto + marginNetto) * 100) / 100;

  let vatAmount = 0;
  let vatLabel: Result["vatLabel"] = "23%";
  if (type === "gospodarczy") {
    vatAmount = totalNetto * 0.23;
    vatLabel = "23%";
  } else if (safeArea <= 300 || safeArea <= 0) {
    vatAmount = totalNetto * 0.08;
    vatLabel = "8%";
  } else {
    const f8 = 300 / safeArea;
    const f23 = (safeArea - 300) / safeArea;
    vatAmount = totalNetto * f8 * 0.08 + totalNetto * f23 * 0.23;
    vatLabel = "Mieszany";
  }
  vatAmount = Math.round(vatAmount * 100) / 100;

  const totalBrutto = Math.round((totalNetto + vatAmount) * 100) / 100;
  const commission = Math.round(((cfg.commissionPercent / 100) * marginNetto) * 100) / 100;

  return {
    area: safeArea,
    basePricePerM2,
    baseNetto,
    marginNetto,
    marginAutoDefault,
    totalNetto,
    vatAmount,
    vatLabel,
    totalBrutto,
    commission,
    commissionPercent: cfg.commissionPercent,
    marginPerM2: cfg.marginPerM2,
  };
}

export function CommissionCalculator({ testID, compact = false }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [areaText, setAreaText] = useState("150");
  const [type, setType] = useState<BuildingType>("mieszkalny");
  const [marginText, setMarginText] = useState<string>(""); // empty = use auto default
  const [marginTouched, setMarginTouched] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.get("/settings");
        if (!mounted) return;
        setSettings({
          commission_percent:
            typeof res.data?.commission_percent === "number" ? res.data.commission_percent : 50,
          margin_per_m2: typeof res.data?.margin_per_m2 === "number" ? res.data.margin_per_m2 : 50,
          base_price_low: typeof res.data?.base_price_low === "number" ? res.data.base_price_low : 275,
          base_price_high: typeof res.data?.base_price_high === "number" ? res.data.base_price_high : 200,
        });
      } catch (e) {
        if (!mounted) return;
        setErr(formatApiError(e));
        setSettings({ commission_percent: 50, margin_per_m2: 50, base_price_low: 275, base_price_high: 200 });
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

  const marginOverride = useMemo(() => {
    if (!marginTouched) return null;
    const v = parseFloat((marginText || "").replace(",", "."));
    return isFinite(v) && v >= 0 ? v : null;
  }, [marginText, marginTouched]);

  const result = useMemo(() => {
    return computeAll(area, type, marginOverride, {
      commissionPercent: settings?.commission_percent ?? 50,
      marginPerM2: settings?.margin_per_m2 ?? 50,
      basePriceLow: settings?.base_price_low ?? 275,
      basePriceHigh: settings?.base_price_high ?? 200,
    });
  }, [area, type, marginOverride, settings]);

  // Keep the margin input synced with auto-default when user hasn't overridden
  useEffect(() => {
    if (!marginTouched) {
      setMarginText(String(result.marginAutoDefault.toFixed(0)));
    }
  }, [result.marginAutoDefault, marginTouched]);

  const resetMargin = () => {
    setMarginTouched(false);
    setMarginText(String(result.marginAutoDefault.toFixed(0)));
  };

  const vatTone =
    result.vatLabel === "8%"
      ? { bg: "#DCFCE7", fg: "#166534" }
      : result.vatLabel === "23%"
      ? { bg: "#FEE2E2", fg: "#991B1B" }
      : { bg: "#E0F2FE", fg: "#0369A1" };

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
              : `${result.commissionPercent}% marży · baza ${fmtPln(result.basePricePerM2)}/m²`}
          </Text>
        </View>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
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
                    { key: "mieszkalny", label: "Mieszkalny", icon: "home" as const, hint: "VAT 8%" },
                    { key: "gospodarczy", label: "Gospodarczy", icon: "box" as const, hint: "VAT 23%" },
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
                      <Feather name={o.icon} size={14} color={active ? "#fff" : colors.textPrimary} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.segText, active && { color: "#fff" }]}>{o.label}</Text>
                        <Text style={[styles.segHint, active && { color: "#DBEAFE" }]}>{o.hint}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Area */}
              <Text style={[styles.label, { marginTop: 10 }]}>Powierzchnia dachu</Text>
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
                      <Text style={[styles.chipText, area === v && { color: "#fff" }]}>{v}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Editable margin */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
                <Text style={[styles.label, { marginTop: 0, marginBottom: 0 }]}>Całkowita marża (PLN)</Text>
                {marginTouched && (
                  <TouchableOpacity onPress={resetMargin} testID="commission-margin-reset" style={styles.resetBtn}>
                    <Feather name="rotate-ccw" size={11} color={colors.primary} />
                    <Text style={styles.resetText}>AUTO</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.marginInputWrap}>
                <TextInput
                  style={styles.areaInput}
                  value={marginText}
                  onChangeText={(v) => {
                    setMarginText(v);
                    setMarginTouched(true);
                  }}
                  keyboardType="decimal-pad"
                  placeholder={String(result.marginAutoDefault.toFixed(0))}
                  placeholderTextColor={colors.textSecondary}
                  testID="commission-margin-input"
                />
                <Text style={styles.areaUnit}>PLN</Text>
              </View>
              <Text style={styles.hint}>
                Auto: {result.area} m² × {fmtPln(result.marginPerM2)}/m² ={" "}
                <Text style={{ fontWeight: "800" }}>{fmtPln(result.marginAutoDefault)}</Text>
              </Text>

              {/* Full breakdown */}
              <View style={[styles.breakdown, compact && { paddingHorizontal: 10 }]}>
                <View style={styles.breakRow}>
                  <Text style={styles.breakLabel}>
                    Cena bazowa netto ({fmtPln(result.basePricePerM2)}/m² × {result.area} m²)
                  </Text>
                  <Text style={styles.breakValue}>{fmtPln(result.baseNetto)}</Text>
                </View>
                <View style={styles.breakRow}>
                  <Text style={styles.breakLabel}>+ Marża{marginTouched ? " (ręczna)" : ""}</Text>
                  <Text style={[styles.breakValue, { color: colors.secondary }]}>
                    + {fmtPln(result.marginNetto)}
                  </Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.breakRow}>
                  <Text style={[styles.breakLabel, { fontWeight: "800", color: colors.textPrimary }]}>
                    Cena netto
                  </Text>
                  <Text style={[styles.breakValue, { fontSize: 14 }]}>{fmtPln(result.totalNetto)}</Text>
                </View>
                <View style={styles.breakRow}>
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={styles.breakLabel}>VAT</Text>
                    <View style={[styles.vatBadge, { backgroundColor: vatTone.bg }]}>
                      <Text style={{ fontSize: 10, fontWeight: "900", color: vatTone.fg }}>
                        {result.vatLabel}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.breakValueMuted}>+ {fmtPln(result.vatAmount)}</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.breakRow}>
                  <Text style={[styles.breakLabel, { fontWeight: "900", color: colors.inverted, fontSize: 13 }]}>
                    Cena brutto
                  </Text>
                  <Text style={[styles.breakValue, { fontSize: 16, color: colors.inverted }]} testID="commission-brutto">
                    {fmtPln(result.totalBrutto)}
                  </Text>
                </View>
              </View>

              {/* Commission highlight */}
              <View style={styles.commissionCard} testID="commission-result">
                <View style={{ flex: 1 }}>
                  <Text style={styles.commissionCap}>Prowizja handlowca</Text>
                  <Text style={styles.commissionHint}>
                    {result.commissionPercent}% × {fmtPln(result.marginNetto)}
                  </Text>
                </View>
                <Text style={styles.commissionAmount} testID="commission-amount">
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
  title: { fontSize: 15, fontWeight: "900", color: colors.textPrimary, letterSpacing: -0.2 },
  subtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  body: { padding: spacing.md, paddingTop: 0, borderTopWidth: 1, borderTopColor: colors.zinc100 },
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
  marginInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: colors.secondary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    backgroundColor: "#F0FDF4",
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
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: `${colors.primary}15`,
  },
  resetText: { fontSize: 9, fontWeight: "900", color: colors.primary, letterSpacing: 1 },
  breakdown: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 12,
    gap: 6,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  breakRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  breakLabel: { flex: 1, fontSize: 12, color: colors.textSecondary },
  breakValue: { fontSize: 13, fontWeight: "800", color: colors.textPrimary, fontVariant: ["tabular-nums"] },
  breakValueMuted: { fontSize: 12, fontWeight: "700", color: colors.textSecondary, fontVariant: ["tabular-nums"] },
  vatBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  commissionCard: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.secondary,
    padding: 14,
    borderRadius: radius.md,
  },
  commissionCap: { color: "#fff", fontSize: 11, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  commissionHint: { color: "#F0FDF4", fontSize: 11, marginTop: 2, fontWeight: "600" },
  commissionAmount: { color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  err: { color: colors.error, fontSize: 12, marginTop: 8 },
});
