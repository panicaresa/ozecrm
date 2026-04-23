import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, radius, spacing } from "../theme";
import { api, formatApiError } from "../lib/api";
import { FilterableList, FilterChip, SortOption } from "./FilterableList";
import { User } from "../lib/auth";

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
  // for admin secondary filter
  rep_manager_id?: string | null;
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
    return new Date(iso).toISOString().slice(0, 10);
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
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    if (isSameDay(d, today)) return "📅 DZISIAJ";
    if (isSameDay(d, tomorrow)) return "📅 JUTRO";
    return `📅 ${d
      .toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })
      .toUpperCase()}`;
  } catch {
    return key;
  }
}

const sorters: SortOption<Meeting>[] = [
  {
    key: "meeting_asc",
    label: "Najbliższe",
    comparator: (a, b) => {
      const ta = a.meeting_at ? new Date(a.meeting_at).getTime() : Infinity;
      const tb = b.meeting_at ? new Date(b.meeting_at).getTime() : Infinity;
      return ta - tb;
    },
  },
  {
    key: "meeting_desc",
    label: "Najdalsze",
    comparator: (a, b) => {
      const ta = a.meeting_at ? new Date(a.meeting_at).getTime() : -Infinity;
      const tb = b.meeting_at ? new Date(b.meeting_at).getTime() : -Infinity;
      return tb - ta;
    },
  },
];

export function CalendarScreen({ role, testID }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const calls: Promise<any>[] = [api.get<Meeting[]>("/calendar/meetings")];
      if (role !== "handlowiec") {
        calls.push(api.get<User[]>("/users"));
      }
      const [mRes, uRes] = await Promise.all(calls);
      setItems(mRes.data);
      if (uRes?.data) {
        setUsers(uRes.data);
        // Decorate meetings with rep_manager_id so admin can filter by manager
        const byId = new Map<string, User>(uRes.data.map((u: User) => [u.id, u]));
        setItems((ms) =>
          mRes.data.map((m: Meeting) => ({
            ...m,
            rep_manager_id: (m.rep_id && byId.get(m.rep_id)?.manager_id) || null,
          }))
        );
      }
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Filters ─────────────────────────────────────────────────────────────
  const repFilters: FilterChip<Meeting>[] = useMemo(() => {
    if (role === "handlowiec") return [];
    const reps = users.filter((u) => u.role === "handlowiec");
    return [
      { key: "all", label: "Wszyscy", predicate: () => true, default: true },
      ...reps.map((r) => ({
        key: r.id,
        label: r.name || r.email,
        count: items.filter((m) => m.rep_id === r.id).length,
        predicate: (m: Meeting) => m.rep_id === r.id,
      })),
    ];
  }, [role, users, items]);

  const managerFilters: FilterChip<Meeting>[] = useMemo(() => {
    if (role !== "admin") return [];
    const managers = users.filter((u) => u.role === "manager");
    return [
      { key: "all", label: "Wszyscy managerowie", predicate: () => true, default: true },
      ...managers.map((m) => ({
        key: m.id,
        label: m.name || m.email,
        count: items.filter((it) => it.rep_manager_id === m.id).length,
        predicate: (it: Meeting) => it.rep_manager_id === m.id,
      })),
    ];
  }, [role, users, items]);

  // Primary row: for handlowiec — empty (no chips shown). For manager — reps.
  // For admin — managers. Secondary for admin = reps.
  const primary = role === "handlowiec" ? [] : role === "manager" ? repFilters : managerFilters;
  const secondary = role === "admin" ? repFilters : [];

  const persistKey =
    role === "handlowiec" ? "rep-calendar" : role === "manager" ? "manager-calendar" : "admin-calendar";

  const title =
    role === "handlowiec" ? "Mój kalendarz" : role === "manager" ? "Kalendarz zespołu" : "Kalendarz firmy";

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const renderItem = (m: Meeting) => (
    <TouchableOpacity
      key={m.lead_id}
      style={styles.meetingRow}
      onPress={() =>
        router.push(
          `/(${role === "manager" ? "manager" : role === "admin" ? "manager" : "rep"})/lead/${m.lead_id}` as any
        )
      }
      testID={`meeting-${m.lead_id}`}
      activeOpacity={0.8}
    >
      <View style={styles.timeCol}>
        <Text style={styles.timeText}>{fmtTime(m.meeting_at)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.clientName}>{m.client_name || "—"}</Text>
        <Text style={styles.clientSub} numberOfLines={1}>
          {m.address || "Brak adresu"}
          {m.phone ? ` · ${m.phone}` : ""}
        </Text>
        {role !== "handlowiec" && m.rep_name && (
          <Text style={styles.repTag}>👤 {m.rep_name}</Text>
        )}
      </View>
      <Feather name="chevron-right" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );

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

      <FilterableList<Meeting>
        data={items}
        keyExtractor={(m) => m.lead_id}
        renderItem={renderItem}
        filters={primary.length > 0 ? primary : undefined}
        secondaryFilters={secondary.length > 0 ? secondary : undefined}
        sorters={sorters}
        searchPlaceholder="Szukaj: klient, telefon, adres..."
        searchFields={[
          (m) => m.client_name || "",
          (m) => m.phone || "",
          (m) => m.address || "",
          (m) => m.rep_name || "",
        ]}
        groupBy={{
          keyExtractor: (m) => dayKey(m.meeting_at),
          sectionTitle: (k) => dayLabel(k),
          sortSections: "asc",
        }}
        persistKey={persistKey}
        loading={loading}
        emptyState={() => (
          <View style={styles.emptyBox} testID="calendar-empty">
            <Feather name="calendar" size={32} color={colors.textSecondary} />
            <Text style={styles.emptyText}>{err || "Brak umówionych spotkań"}</Text>
            {!err && (
              <Text style={styles.emptySub}>
                Gdy handlowiec ustawi status leada na „Umówione" + doda datę spotkania, pojawi się tu.
              </Text>
            )}
          </View>
        )}
        testID={`calendar-list-${role}`}
      />
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
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary },
  badge: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: `${colors.primary}15`,
  },
  badgeText: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  meetingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  timeCol: { width: 60, backgroundColor: colors.inverted, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  timeText: { color: "#fff", fontWeight: "900", fontSize: 13 },
  clientName: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  clientSub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  repTag: { fontSize: 11, color: colors.secondary, marginTop: 4, fontWeight: "700" },
  emptyBox: {
    alignItems: "center",
    padding: 32,
    gap: 8,
  },
  emptyText: { fontSize: 14, fontWeight: "800", color: colors.textPrimary, marginTop: 4 },
  emptySub: { fontSize: 12, color: colors.textSecondary, textAlign: "center", lineHeight: 16 },
});
