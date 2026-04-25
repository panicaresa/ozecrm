import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { buildTelUrl } from "../../src/lib/inputFormatters";
import { api, formatApiError } from "../../src/lib/api";
import { colors, spacing } from "../../src/theme";
import { LeadCard, Lead } from "../../src/components/LeadCard";
import {
  FilterableList,
  FilterChip,
  SortOption,
  SwipeAction,
} from "../../src/components/FilterableList";

// Sprint 2 — My Leads 2.0. Thin wrapper around FilterableList.
// Filters, sorters, grouping and swipe actions are defined here and passed
// to the reusable component.

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function ts(iso?: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return isNaN(t) ? 0 : t;
}

function buildFilters(leads: Lead[]): FilterChip<Lead>[] {
  const chips: FilterChip<Lead>[] = [
    {
      key: "active",
      label: "Aktywne",
      predicate: (l) => !["nie_zainteresowany", "podpisana"].includes(l.status),
      default: true,
    },
    { key: "all", label: "Wszystkie", predicate: () => true },
    { key: "umowione", label: "Umówione", predicate: (l) => l.status === "umowione" },
    { key: "decyzja", label: "Decyzja", predicate: (l) => l.status === "decyzja" },
    { key: "nowy", label: "Nowe", predicate: (l) => l.status === "nowy" },
    { key: "podpisana", label: "Podpisane", predicate: (l) => l.status === "podpisana" },
    {
      key: "nie_zainteresowany",
      label: "N. zainteresowany",
      predicate: (l) => l.status === "nie_zainteresowany",
    },
    {
      key: "followup",
      label: "Do follow-up",
      predicate: (l) => {
        if (l.status !== "nie_zainteresowany") return false;
        return ts(l.created_at) < Date.now() - NINETY_DAYS_MS;
      },
    },
  ];
  // Attach live counts
  return chips.map((c) => ({ ...c, count: leads.filter(c.predicate).length }));
}

const sorters: SortOption<Lead>[] = [
  {
    key: "meeting_date",
    label: "Data spotkania",
    comparator: (a, b) => {
      const ta = ts(a.meeting_at);
      const tb = ts(b.meeting_at);
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return ta - tb;
    },
  },
  {
    key: "created_desc",
    label: "Najnowsze",
    comparator: (a, b) => ts(b.created_at) - ts(a.created_at),
  },
  {
    key: "status_funnel",
    label: "Lejek",
    comparator: (a, b) => {
      const order = ["nowy", "umowione", "decyzja", "podpisana", "nie_zainteresowany"];
      return order.indexOf(a.status) - order.indexOf(b.status);
    },
  },
];

const defaultSortKeyByFilter: Record<string, string> = {
  umowione: "meeting_date",
  active: "created_desc",
  all: "created_desc",
  nowy: "created_desc",
  decyzja: "created_desc",
  podpisana: "created_desc",
  nie_zainteresowany: "created_desc",
  followup: "created_desc",
};

const emptyCopy: Record<string, { icon: keyof typeof Feather.glyphMap; title: string; sub: string }> = {
  active: { icon: "inbox", title: "Brak aktywnych leadów", sub: "Tap + żeby dodać pierwszego." },
  umowione: {
    icon: "calendar",
    title: "Brak umówionych spotkań",
    sub: "Zmień status leada na 'Umówione' i dodaj datę.",
  },
  followup: {
    icon: "refresh-cw",
    title: "Brak leadów do follow-up",
    sub: "Pojawią się tu po 90 dniach od oznaczenia 'Nie zainteresowany'.",
  },
  nowy: { icon: "user-plus", title: "Brak nowych leadów", sub: "" },
  decyzja: { icon: "help-circle", title: "Brak leadów w decyzji", sub: "" },
  podpisana: { icon: "check-circle", title: "Brak podpisanych umów", sub: "" },
  nie_zainteresowany: { icon: "x-circle", title: "Brak leadów ‚nie zainteresowany'", sub: "" },
  all: { icon: "inbox", title: "Brak leadów", sub: "" },
};

function dayKey(iso?: string | null) {
  if (!iso) return "Bez daty";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "Bez daty";
  }
}

function dayLabel(key: string) {
  if (key === "Bez daty") return "BEZ DATY";
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (key === today) return "📅 DZISIAJ";
  if (key === tomorrow) return "📅 JUTRO";
  try {
    const d = new Date(key + "T12:00:00Z");
    return `📅 ${d
      .toLocaleDateString("pl-PL", { weekday: "long", day: "2-digit", month: "long" })
      .toUpperCase()}`;
  } catch {
    return key;
  }
}

export default function MyLeads() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await api.get<Lead[]>("/leads");
      setLeads(res.data);
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

  // Sprint 5-pre-tris (ISSUE-UX-001 follow-up): refetch leads list on every
  // focus so newly-signed contracts (which auto-flip lead.status to
  // "podpisana" server-side) are reflected when the user returns from
  // /add-contract or any nested screen.
  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(() => {
        load();
      }, 50);
      return () => clearTimeout(t);
    }, [load])
  );

  const filters = useMemo(() => buildFilters(leads), [leads]);

  const swipeActions: SwipeAction<Lead>[] = useMemo(
    () => [
      {
        key: "call",
        icon: "phone",
        label: "Zadzwoń",
        color: colors.success,
        onPress: (l) => {
          // Sprint 5-pre-pent — buildTelUrl prefixes +48 for raw 9-digit
          // Polish numbers and gracefully passes through international
          // formats from legacy data.
          const url = buildTelUrl(l.phone);
          if (url) Linking.openURL(url).catch(() => {});
        },
      },
      {
        key: "navigate",
        icon: "map-pin",
        label: "Mapy",
        color: colors.info,
        onPress: (l) => {
          if (l.latitude == null || l.longitude == null) return;
          const url =
            Platform.OS === "ios"
              ? `maps:?daddr=${l.latitude},${l.longitude}`
              : Platform.OS === "android"
              ? `google.navigation:q=${l.latitude},${l.longitude}`
              : `https://www.google.com/maps/dir/?api=1&destination=${l.latitude},${l.longitude}`;
          Linking.openURL(url).catch(() => {});
        },
      },
      {
        key: "offer",
        icon: "file-text",
        label: "Oferta",
        color: colors.primary,
        onPress: (l) =>
          router.push({ pathname: "/(rep)/offer-generator", params: { lead_id: l.id } } as any),
      },
    ],
    [router]
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.back}
          onPress={() => router.back()}
          testID="my-leads-back-button"
        >
          <Feather name="arrow-left" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Moje leady</Text>
          <Text style={styles.sub}>{leads.length} pozycji</Text>
        </View>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push("/(rep)/add-lead")}
          testID="add-lead-from-list"
        >
          <Feather name="plus" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
      <FilterableList<Lead>
        data={leads}
        keyExtractor={(l) => l.id}
        renderItem={(item) => (
          <LeadCard
            lead={item}
            onPress={() => router.push(`/(rep)/lead/${item.id}` as any)}
            testID={`my-lead-${item.id}`}
          />
        )}
        filters={filters}
        sorters={sorters}
        defaultSortKeyByFilter={defaultSortKeyByFilter}
        searchPlaceholder="Szukaj po nazwisku, telefonie, adresie..."
        searchFields={[(l) => l.client_name || "", (l) => l.phone || "", (l) => l.address || ""]}
        groupBy={{
          enabledForFilters: ["umowione"],
          keyExtractor: (l) => dayKey(l.meeting_at),
          sectionTitle: (k) => dayLabel(k),
          sortSections: "asc",
        }}
        swipeActions={swipeActions}
        persistKey="rep-my-leads"
        loading={loading}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          load();
        }}
        emptyState={(filterKey) => {
          const copy = emptyCopy[filterKey || "active"] || emptyCopy.all;
          return (
            <View style={styles.emptyBox} testID="my-leads-empty">
              <Feather name={copy.icon} size={30} color={colors.textSecondary} />
              <Text style={styles.emptyTitle}>{err || copy.title}</Text>
              {!err && !!copy.sub && <Text style={styles.emptySub}>{copy.sub}</Text>}
            </View>
          );
        }}
        testID="my-leads-list"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, gap: 12 },
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
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  sub: { fontSize: 12, color: colors.textSecondary },
  emptyBox: { alignItems: "center", padding: 32, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: colors.textPrimary, marginTop: 6 },
  emptySub: { fontSize: 12, color: colors.textSecondary, textAlign: "center", lineHeight: 17 },
});
