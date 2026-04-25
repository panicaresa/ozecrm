import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { buildTelUrl } from "../../src/lib/inputFormatters";
import { api, formatApiError } from "../../src/lib/api";
import { colors, radius, spacing } from "../../src/theme";
import { LeadCard, Lead } from "../../src/components/LeadCard";
import {
  FilterableList,
  FilterChip,
  SortOption,
  SwipeAction,
} from "../../src/components/FilterableList";
import { User } from "../../src/lib/auth";

// Sprint 2 — Manager Leads 2.0.
// Same primary filters as My Leads + secondary "by rep" chips.

function ts(iso?: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return isNaN(t) ? 0 : t;
}

function buildPrimaryFilters(leads: Lead[]): FilterChip<Lead>[] {
  const base: FilterChip<Lead>[] = [
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
  ];
  return base.map((c) => ({ ...c, count: leads.filter(c.predicate).length }));
}

function buildRepFilters(reps: User[], leads: Lead[]): FilterChip<Lead>[] {
  const chips: FilterChip<Lead>[] = [
    { key: "all", label: "Wszyscy", predicate: () => true, default: true },
  ];
  for (const r of reps) {
    const label = r.name || r.email;
    chips.push({
      key: r.id,
      label,
      predicate: (l) => l.assigned_to === r.id,
      count: leads.filter((l) => l.assigned_to === r.id).length,
    });
  }
  return chips;
}

const sorters: SortOption<Lead>[] = [
  {
    key: "created_desc",
    label: "Najnowsze",
    comparator: (a, b) => ts(b.created_at) - ts(a.created_at),
  },
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
    key: "status_funnel",
    label: "Lejek",
    comparator: (a, b) => {
      const order = ["nowy", "umowione", "decyzja", "podpisana", "nie_zainteresowany"];
      return order.indexOf(a.status) - order.indexOf(b.status);
    },
  },
];

export default function ManagerLeads() {
  const router = useRouter();
  const params = useLocalSearchParams<{ rep_id?: string; created_today?: string }>();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [reps, setReps] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drillActive, setDrillActive] = useState(false);

  // Activate drill filter whenever ?rep_id=... arrives. User can clear it.
  useEffect(() => {
    if (params.rep_id || params.created_today) setDrillActive(true);
  }, [params.rep_id, params.created_today]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [leadsRes, usersRes] = await Promise.all([
        api.get<Lead[]>("/leads"),
        api.get<User[]>("/users"),
      ]);
      setLeads(leadsRes.data);
      // Only handlowiec members in the rep filter; drop admins/managers
      setReps((usersRes.data || []).filter((u) => u.role === "handlowiec"));
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

  // Sprint 5-pre-tris (ISSUE-UX-001 follow-up): refetch on every focus so
  // post-contract auto-status flips ("podpisana") are reflected when the
  // user returns from any nested screen (rep profile, lead detail, etc.).
  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(() => load(), 50);
      return () => clearTimeout(t);
    }, [load])
  );

  const primaryFilters = useMemo(() => buildPrimaryFilters(leads), [leads]);
  const repFilters = useMemo(() => buildRepFilters(reps, leads), [reps, leads]);

  // Drill-down source-filter (from daily-report chip: rep_id + created_today).
  const filteredLeads = useMemo(() => {
    if (!drillActive) return leads;
    let out = leads;
    if (params.rep_id) {
      out = out.filter((l) => l.assigned_to === params.rep_id);
    }
    if (params.created_today === "1") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      out = out.filter((l) => ts(l.created_at) >= start.getTime());
    }
    return out;
  }, [leads, drillActive, params.rep_id, params.created_today]);

  const drillRepName = useMemo(() => {
    if (!params.rep_id) return null;
    const r = reps.find((x) => x.id === params.rep_id);
    return r ? r.name || r.email : params.rep_id;
  }, [params.rep_id, reps]);

  const clearDrillFilter = useCallback(() => {
    setDrillActive(false);
    router.setParams({ rep_id: undefined, created_today: undefined } as never);
  }, [router]);

  const swipeActions: SwipeAction<Lead>[] = useMemo(
    () => [
      {
        key: "call",
        icon: "phone",
        label: "Zadzwoń",
        color: colors.success,
        onPress: (l) => {
          if (l.phone) {
            const url = buildTelUrl(l.phone);
            if (url) Linking.openURL(url).catch(() => {});
          }
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
        key: "rep-profile",
        icon: "user",
        label: "Handlowiec",
        color: colors.primary,
        onPress: (l) => {
          if (l.assigned_to) router.push(`/(manager)/rep/${l.assigned_to}` as any);
        },
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
          testID="leads-back-button"
        >
          <Feather name="arrow-left" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Leady zespołu</Text>
          <Text style={styles.sub}>
            {drillActive
              ? `${filteredLeads.length} z ${leads.length} pozycji (filtr drill-down)`
              : `${leads.length} pozycji · ${reps.length} handlowców`}
          </Text>
        </View>
      </View>
      {drillActive && (
        <View style={styles.drillBanner} testID="manager-leads-drill-banner">
          <Feather name="filter" size={14} color={colors.primary} />
          <Text style={styles.drillBannerText} numberOfLines={2}>
            Filtr drill-down:
            {drillRepName ? ` handlowiec ${drillRepName}` : ""}
            {params.created_today === "1" ? " · dodane dziś" : ""}
          </Text>
          <TouchableOpacity
            onPress={clearDrillFilter}
            style={styles.drillClearBtn}
            hitSlop={8}
            testID="manager-leads-drill-clear"
            accessibilityLabel="Wyczyść filtr"
          >
            <Feather name="x" size={14} color={colors.primary} />
          </TouchableOpacity>
        </View>
      )}
      <FilterableList<Lead>
        data={filteredLeads}
        keyExtractor={(l) => l.id}
        renderItem={(item) => <LeadCard lead={item} testID={`lead-${item.id}`} />}
        filters={primaryFilters}
        secondaryFilters={repFilters}
        sorters={sorters}
        searchPlaceholder="Szukaj po nazwisku, telefonie, adresie..."
        searchFields={[(l) => l.client_name || "", (l) => l.phone || "", (l) => l.address || ""]}
        swipeActions={swipeActions}
        persistKey="manager-leads"
        loading={loading}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          load();
        }}
        emptyState={() => (
          <View style={styles.emptyBox} testID="manager-leads-empty">
            <Feather name="inbox" size={30} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>{err || "Brak leadów"}</Text>
            {!err && (
              <Text style={styles.emptySub}>
                {drillActive
                  ? "Brak leadów spełniających filtr drill-down. Wyczyść filtr, aby zobaczyć pełną listę."
                  : "Zmień filtr lub odśwież listę. Dodawanie leadów to zadanie handlowca."}
              </Text>
            )}
          </View>
        )}
        testID="manager-leads-list"
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
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  sub: { fontSize: 12, color: colors.textSecondary },
  drillBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
    backgroundColor: `${colors.primary}10`,
  },
  drillBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
    lineHeight: 16,
  },
  drillClearBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
  },
  emptyBox: { alignItems: "center", padding: 32, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: colors.textPrimary, marginTop: 6 },
  emptySub: { fontSize: 12, color: colors.textSecondary, textAlign: "center", lineHeight: 17 },
});
