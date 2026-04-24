import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import * as Battery from "expo-battery";
import { startBackgroundTracking, stopBackgroundTracking, isBackgroundTrackingActive } from "../../src/lib/backgroundTracking";
import { useWorkStatus, fmtDuration, fmtDistanceKm } from "../../src/lib/useWorkStatus";
import { colors, radius, spacing } from "../../src/theme";
import { useAuth } from "../../src/lib/auth";
import { api, formatApiError } from "../../src/lib/api";
import { Button } from "../../src/components/Button";
import { BrandLogo } from "../../src/components/BrandLogo";
import { CommissionCalculator } from "../../src/components/CommissionCalculator";
import { QueueBadge } from "../../src/components/QueueBadge";

interface RepSummary {
  total_leads: number;
  signed: number;
  meetings: number;
  target: number;
  percent: number;
}

export default function RepHome() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [summary, setSummary] = useState<RepSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false); // Start/Stop mode
  const { status: workStatus, refresh: refreshWorkStatus } = useWorkStatus(working ? 10000 : 30000);

  // Sync local "working" state with backend on first mount
  useEffect(() => {
    setWorking(workStatus.is_working);
  }, [workStatus.is_working]);
  const [workLoading, setWorkLoading] = useState(false);
  const [lastPush, setLastPush] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const locationRef = useRef<{ stop?: () => void } | null>(null);
  const intervalRef = useRef<any>(null);

  const pushLocation = useCallback(async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      let battery: number | null = null;
      let batteryState: string | undefined;
      try {
        battery = await Battery.getBatteryLevelAsync();
        const st = await Battery.getBatteryStateAsync();
        batteryState = ["unknown", "unplugged", "charging", "full"][st ?? 0];
      } catch { /* web or unsupported */ }
      await api.put("/rep/location", {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? null,
        battery,
        battery_state: batteryState,
      });
      setLastPush(new Date());
    } catch (e) {
      console.warn("Location push failed", (e as any)?.message);
    }
  }, []);

  const startWorkMode = useCallback(async () => {
    setWorkLoading(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert(
          "Brak uprawnień",
          "Aby uruchomić tryb pracy, pozwól aplikacji na dostęp do lokalizacji."
        );
        return;
      }
      setWorking(true);
      await pushLocation();
      // Foreground fallback — co 30s wysyłamy, gdy aplikacja aktywna
      intervalRef.current = setInterval(pushLocation, 30000);
      // Faza 2.0: Background tracking — kontynuacja przy zgaszonym ekranie
      const bgOk = await startBackgroundTracking();
      if (bgOk) {
        Alert.alert(
          "Tryb pracy aktywny",
          "GPS wysyła pozycję do managera. Działa również przy zgaszonym ekranie (background)."
        );
      } else {
        Alert.alert(
          "Tryb pracy — tylko foreground",
          "Nie udzielono uprawnień do lokalizacji w tle. GPS działa wyłącznie gdy aplikacja jest otwarta."
        );
      }
    } finally {
      setWorkLoading(false);
    }
  }, [pushLocation]);

  const stopWorkMode = useCallback(async () => {
    setWorkLoading(true);
    try {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      await stopBackgroundTracking();
      setWorking(false);
      setLastPush(null);
      try {
        await api.delete("/rep/location");
      } catch {
        /* ignore */
      }
    } finally {
      setWorkLoading(false);
    }
  }, []);

  const toggleWork = () => (working ? stopWorkMode() : startWorkMode());

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await api.get<RepSummary>("/dashboard/rep");
      setSummary(res.data);
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.topbar}>
          <BrandLogo height={28} testID="rep-brand-logo" />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <QueueBadge />
            <TouchableOpacity style={styles.iconBtn} onPress={handleLogout} testID="logout-button">
              <Feather name="log-out" size={18} color={colors.textInverse} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Cześć, {user?.name?.split(" ")[0] || "Handlowcu"}</Text>
            <Text style={styles.sub}>Tryb: Door-to-Door</Text>
          </View>
        </View>

        {/* Start/Stop work mode — big button */}
        <View style={styles.workCard}>
          <Text style={styles.workLabel}>TRYB PRACY</Text>
          <TouchableOpacity
            style={[styles.workBtn, { backgroundColor: working ? colors.error : colors.secondary }]}
            activeOpacity={0.85}
            onPress={toggleWork}
            testID="toggle-work-mode-button"
          >
            <Feather name={working ? "square" : "play"} size={28} color="#fff" />
            <Text style={styles.workBtnText}>{working ? "ZATRZYMAJ" : "ROZPOCZNIJ"}</Text>
          </TouchableOpacity>
          {working && workStatus.is_working && (
            <View style={styles.sessionStats}>
              <View style={styles.sessionStat}>
                <Feather name="clock" size={14} color={colors.secondary} />
                <Text style={styles.sessionStatValue}>{fmtDuration(workStatus.session_seconds)}</Text>
              </View>
              <View style={styles.sessionSep} />
              <View style={styles.sessionStat}>
                <Feather name="navigation" size={14} color={colors.secondary} />
                <Text style={styles.sessionStatValue}>{fmtDistanceKm(workStatus.session_distance_m)}</Text>
              </View>
            </View>
          )}
          <Text style={styles.workHint}>
            {working
              ? "Tryb pracy aktywny · pozycja GPS wysyłana co 30 s"
              : "Uruchom tryb pracy, aby odblokować dodawanie leadów i Generator ofert"}
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Button
            title={working ? "Dodaj leada" : "🔒 Dodaj leada (rozpocznij pracę)"}
            variant="primary"
            icon={<Feather name={working ? "user-plus" : "lock"} size={18} color="#fff" />}
            onPress={() => {
              if (!working) {
                Alert.alert("Tryb pracy wyłączony", "Rozpocznij pracę w terenie, aby odblokować dodawanie leadów.");
                return;
              }
              router.push("/(rep)/add-lead");
            }}
            testID="add-lead-button"
            style={!working ? { opacity: 0.5 } : undefined}
          />
          <Button
            title={working ? "Generator ofert OZE" : "🔒 Generator ofert (rozpocznij pracę)"}
            variant="dark"
            icon={<Feather name={working ? "file-text" : "lock"} size={18} color="#fff" />}
            onPress={() => {
              if (!working) {
                Alert.alert("Tryb pracy wyłączony", "Rozpocznij pracę w terenie, aby uruchomić Generator ofert.");
                return;
              }
              router.push("/(rep)/offer-generator");
            }}
            testID="open-offer-generator-button"
            style={{ ...(!working && { opacity: 0.5 }), marginTop: 10 }}
          />
          <Button
            title="Kalendarz spotkań"
            variant="outline"
            icon={<Feather name="calendar" size={18} color={colors.primary} />}
            onPress={() => router.push("/(rep)/calendar")}
            testID="rep-calendar-button"
            style={{ marginTop: 10 }}
          />
          <Button
            title="Moje zarobki · Finanse"
            variant="secondary"
            icon={<Feather name="dollar-sign" size={18} color="#fff" />}
            onPress={() => router.push("/(rep)/finance")}
            testID="rep-finance-button"
            style={{ marginTop: 10 }}
          />
          <Button
            title="Moje leady"
            variant="outline"
            icon={<Feather name="list" size={18} color={colors.primary} />}
            onPress={() => router.push("/(rep)/my-leads")}
            testID="my-leads-button"
            style={{ marginTop: 10 }}
          />
        </View>

        {/* My results */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Moje wyniki</Text>
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <View style={styles.metricRow}>
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>{summary?.signed || 0}</Text>
                  <Text style={styles.metricLabel}>Podpisane</Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>{summary?.meetings || 0}</Text>
                  <Text style={styles.metricLabel}>Spotkania</Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>{summary?.total_leads || 0}</Text>
                  <Text style={styles.metricLabel}>Leady</Text>
                </View>
              </View>
              <Text style={styles.goalLabel}>
                Cel miesięczny: {summary?.signed || 0} / {summary?.target || 10}
              </Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(100, summary?.percent || 0)}%` }]} />
              </View>
              <Text style={styles.goalPct}>{Math.min(100, summary?.percent || 0)}%</Text>
              {err && <Text style={{ color: colors.error, fontSize: 12, marginTop: 6 }}>{err}</Text>}
            </>
          )}
        </View>

        {/* Szybki kalkulator prowizji */}
        <View style={{ marginHorizontal: spacing.md, marginTop: spacing.md }}>
          <CommissionCalculator testID="rep-commission-calculator" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 4 },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, paddingTop: 4 },
  hello: { fontSize: 22, fontWeight: "900", color: colors.textPrimary },
  sub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.inverted, alignItems: "center", justifyContent: "center" },
  workCard: { margin: spacing.md, padding: spacing.lg, backgroundColor: colors.inverted, borderRadius: radius.lg, alignItems: "center" },
  workLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pulseDot: { width: 8, height: 8, borderRadius: 4 },
  workLabel: { color: colors.textInverseSecondary, fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  workBtn: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 20, paddingHorizontal: 32, borderRadius: 999, marginVertical: 16, minWidth: 260, justifyContent: "center", boxShadow: "0px 4px 10px rgba(0,0,0,0.3)", elevation: 6 },
  workBtnText: { color: "#fff", fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  workHint: { color: colors.textInverseSecondary, fontSize: 12, textAlign: "center" },
  sessionStats: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 10, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: "rgba(16,185,129,0.1)", alignSelf: "center" },
  sessionStat: { flexDirection: "row", alignItems: "center", gap: 5 },
  sessionStatValue: { color: colors.secondary, fontWeight: "900", fontSize: 13, fontVariant: ["tabular-nums"] },
  sessionSep: { width: 1, height: 14, backgroundColor: `${colors.secondary}40` },
  actions: { paddingHorizontal: spacing.md },
  card: { margin: spacing.md, padding: spacing.md, backgroundColor: colors.paper, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 16, fontWeight: "900", color: colors.textPrimary, marginBottom: 12 },
  metricRow: { flexDirection: "row", gap: 8 },
  metric: { flex: 1, backgroundColor: colors.bg, padding: 12, borderRadius: radius.md, alignItems: "center" },
  metricValue: { fontSize: 24, fontWeight: "900", color: colors.textPrimary },
  metricLabel: { fontSize: 11, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 },
  goalLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 14 },
  track: { height: 12, backgroundColor: colors.zinc200, borderRadius: 999, marginTop: 6, overflow: "hidden" },
  fill: { height: 12, backgroundColor: colors.primary, borderRadius: 999 },
  goalPct: { textAlign: "right", fontSize: 12, fontWeight: "900", color: colors.primary, marginTop: 4 },
});
