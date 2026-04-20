import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, radius, spacing } from "../theme";
import { api, formatApiError } from "../lib/api";

export type CalendarRole = "admin" | "manager" | "handlowiec";

interface Meeting {
  lead_id: string;
  client_name?: string;
  phone?: string;
  address?: string;
  meeting_at?: string;
  rep_id?: string;
  rep_name?: string;
  note?: string;
}

interface Props {
  role: CalendarRole;
  testID?: string;
}

function fmtTime(iso?: string) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function dayKey(iso?: string) {
  if (!iso) return "brak-daty";
  try {
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function dayLabel(key: string) {
  if (key === "brak-daty") return "Bez daty";
  try {
    const d = new Date(key + "T12:00:00Z");
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    const isSameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (isSameDay(d, today)) return "Dzisiaj";
    if (isSameDay(d, tomorrow)) return "Jutro";
    return d.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
  } catch {
    return key;
  }
}

export function CalendarScreen({ role, testID }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await api.get<Meeting[]>("/calendar/meetings");
      setItems(res.data);
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

  const grouped = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const m of items) {
      const k = dayKey(m.meeting_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    // sort days ascending
    return Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [items]);

  const title = role === "handlowiec" ? "Mój kalendarz" : role === "manager" ? "Kalendarz zespołu" : "Kalendarz firmy";

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
        <TouchableOpacity style={styles.back} onPress={() => router.back()} testID="calendar-back">
          <Feather name="arrow-left" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{items.length} spotkań</Text>
        </View>
        <View style={styles.badge}>
          <Feather name="calendar" size={12} color={colors.primary} />
          <Text style={styles.badgeText}>{role.toUpperCase()}</Text>
        </View>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
      >
        {err && (
          <View style={styles.errBox}><Text style={styles.errText}>{err}</Text></View>
        )}
        {items.length === 0 && (
          <View style={styles.emptyBox}>
            <Feather name="calendar" size={32} color={colors.textSecondary} />
            <Text style={styles.emptyText}>Brak umówionych spotkań</Text>
            <Text style={styles.emptySub}>Gdy handlowiec ustawi status leada na „Umówione" + doda datę spotkania, pojawi się tu.</Text>
          </View>
        )}
        {grouped.map(([key, day]) => (
          <View key={key} style={styles.daySection}>
            <Text style={styles.dayTitle}>{dayLabel(key)}</Text>
            {day.map((m) => (
              <TouchableOpacity
                key={m.lead_id}
                style={styles.meetingRow}
                onPress={() => router.push(`/(${role === "manager" ? "manager" : role === "admin" ? "manager" : "rep"})/lead/${m.lead_id}` as any)}
                testID={`meeting-${m.lead_id}`}
                activeOpacity={0.8}
              >
                <View style={styles.timeCol}>
                  <Text style={styles.timeText}>{fmtTime(m.meeting_at)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientName}>{m.client_name || "—"}</Text>
                  <Text style={styles.clientSub} numberOfLines={1}>
                    {m.address || "Brak adresu"}{m.phone ? ` · ${m.phone}` : ""}
                  </Text>
                  {role !== "handlowiec" && m.rep_name && (
                    <Text style={styles.repTag}>👤 {m.rep_name}</Text>
                  )}
                </View>
                <Feather name="chevron-right" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", gap: 12, alignItems: "center", padding: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary },
  badge: { flexDirection: "row", gap: 4, alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: `${colors.primary}15` },
  badgeText: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  daySection: { marginBottom: 18 },
  dayTitle: { fontSize: 12, fontWeight: "900", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 },
  meetingRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: colors.paper, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  timeCol: { width: 60, backgroundColor: colors.inverted, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  timeText: { color: "#fff", fontWeight: "900", fontSize: 13 },
  clientName: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  clientSub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  repTag: { fontSize: 11, color: colors.secondary, marginTop: 4, fontWeight: "700" },
  emptyBox: { alignItems: "center", padding: 32, backgroundColor: colors.paper, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, gap: 8 },
  emptyText: { fontSize: 14, fontWeight: "800", color: colors.textPrimary, marginTop: 4 },
  emptySub: { fontSize: 12, color: colors.textSecondary, textAlign: "center", lineHeight: 16 },
  errBox: { padding: 12, backgroundColor: "#fef2f2", borderRadius: radius.md, marginBottom: 10 },
  errText: { color: colors.error, fontSize: 13 },
});
