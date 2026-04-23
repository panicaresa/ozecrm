// Sprint 2 — reusable generic FilterableList.
// Used by: My Leads (rep), Manager Leads, Calendar (all roles).
//
// Features:
//   - Debounced search (500ms) against user-provided searchFields.
//   - Primary filter chips (horizontal scroll) with optional counts.
//   - Optional secondary filter chips (e.g. "by rep" in Manager Leads).
//   - Sort chips (horizontal scroll).
//   - Optional grouping into sections (SectionList) enabled only for
//     certain filter keys (e.g. group by day only when filter=="umowione").
//   - Optional swipe-right actions (Swipeable from react-native-gesture-handler).
//   - Per-screen preference persistence via AsyncStorage.

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  FlatList,
  SectionList,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Swipeable } from "react-native-gesture-handler";
import { colors, radius, spacing } from "../theme";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FilterChip<T> {
  key: string;
  label: string;
  count?: number;
  predicate: (item: T) => boolean;
  default?: boolean;
}

export interface SortOption<T> {
  key: string;
  label: string;
  comparator: (a: T, b: T) => number;
}

export interface SwipeAction<T> {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  color?: string;
  onPress: (item: T) => void;
}

export interface GroupByConfig<T> {
  enabledForFilters?: string[];
  keyExtractor: (item: T) => string;
  sectionTitle: (key: string) => string;
  sortSections?: "asc" | "desc";
}

export interface FilterableListProps<T> {
  data: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, index: number) => React.ReactElement;

  filters?: FilterChip<T>[];
  secondaryFilters?: FilterChip<T>[];
  sorters?: SortOption<T>[];
  defaultSortKeyByFilter?: Record<string, string>;

  searchPlaceholder?: string;
  searchFields?: ((item: T) => string)[];

  groupBy?: GroupByConfig<T>;

  swipeActions?: SwipeAction<T>[];

  persistKey?: string;

  emptyState?: (activeFilterKey: string | null) => React.ReactElement;

  loading?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;

  testID?: string;
}

interface PersistedPrefs {
  filterKey?: string;
  secondaryFilterKey?: string;
  sortKey?: string;
  search?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pickDefault<T>(chips: FilterChip<T>[] | undefined): string | null {
  if (!chips || chips.length === 0) return null;
  const d = chips.find((c) => c.default);
  return (d || chips[0]).key;
}

async function loadPrefs(persistKey?: string): Promise<PersistedPrefs | null> {
  if (!persistKey) return null;
  try {
    const raw = await AsyncStorage.getItem(`filterprefs:${persistKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : null;
  } catch {
    return null;
  }
}

async function savePrefs(persistKey: string | undefined, prefs: PersistedPrefs): Promise<void> {
  if (!persistKey) return;
  try {
    await AsyncStorage.setItem(`filterprefs:${persistKey}`, JSON.stringify(prefs));
  } catch {}
}

function useDebounced<V>(value: V, delay = 500): V {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

// ── Swipeable item wrapper ───────────────────────────────────────────────────

interface SwipeableRowProps<T> {
  item: T;
  child: React.ReactElement;
  actions: SwipeAction<T>[];
}

function SwipeableRow<T>({ item, child, actions }: SwipeableRowProps<T>) {
  const ref = useRef<Swipeable>(null);
  if (!actions || actions.length === 0) return child;

  const renderRight = () => (
    <View style={styles.swipeActions}>
      {actions.map((a) => (
        <TouchableOpacity
          key={a.key}
          onPress={() => {
            try {
              ref.current?.close();
            } catch {}
            a.onPress(item);
          }}
          style={[styles.swipeBtn, { backgroundColor: a.color || colors.secondary }]}
          accessibilityLabel={a.label}
          testID={`swipe-action-${a.key}`}
        >
          <Feather name={a.icon} size={18} color="#fff" />
          <Text style={styles.swipeBtnLabel}>{a.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <Swipeable ref={ref} renderRightActions={renderRight} overshootRight={false}>
      {child}
    </Swipeable>
  );
}

// ── FilterableList ───────────────────────────────────────────────────────────

function FilterableListInner<T>(props: FilterableListProps<T>) {
  const {
    data,
    keyExtractor,
    renderItem,
    filters,
    secondaryFilters,
    sorters,
    defaultSortKeyByFilter,
    searchPlaceholder,
    searchFields,
    groupBy,
    swipeActions,
    persistKey,
    emptyState,
    loading,
    refreshing,
    onRefresh,
    testID,
  } = props;

  // ── Active state ────────────────────────────────────────────────────────
  const [filterKey, setFilterKey] = useState<string | null>(() => pickDefault(filters));
  const [secondaryFilterKey, setSecondaryFilterKey] = useState<string | null>(() =>
    pickDefault(secondaryFilters)
  );
  const [sortKey, setSortKey] = useState<string | null>(() => {
    if (!sorters || sorters.length === 0) return null;
    return sorters[0].key;
  });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 500);
  const [prefsLoaded, setPrefsLoaded] = useState(!persistKey);

  // ── Load persisted preferences on mount ────────────────────────────────
  useEffect(() => {
    let alive = true;
    if (!persistKey) {
      setPrefsLoaded(true);
      return;
    }
    loadPrefs(persistKey).then((p) => {
      if (!alive) return;
      if (p) {
        if (p.filterKey && filters?.some((f) => f.key === p.filterKey)) {
          setFilterKey(p.filterKey);
        }
        if (
          p.secondaryFilterKey &&
          secondaryFilters?.some((f) => f.key === p.secondaryFilterKey)
        ) {
          setSecondaryFilterKey(p.secondaryFilterKey);
        }
        if (p.sortKey && sorters?.some((s) => s.key === p.sortKey)) {
          setSortKey(p.sortKey);
        }
        if (typeof p.search === "string") setSearch(p.search);
      }
      setPrefsLoaded(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistKey]);

  // ── Persist preferences (after prefsLoaded to avoid clobbering) ────────
  useEffect(() => {
    if (!persistKey || !prefsLoaded) return;
    savePrefs(persistKey, {
      filterKey: filterKey || undefined,
      secondaryFilterKey: secondaryFilterKey || undefined,
      sortKey: sortKey || undefined,
      search: debouncedSearch || undefined,
    });
  }, [persistKey, prefsLoaded, filterKey, secondaryFilterKey, sortKey, debouncedSearch]);

  // ── Default sort swap when filter changes ──────────────────────────────
  useEffect(() => {
    if (!prefsLoaded) return;
    if (!defaultSortKeyByFilter || !filterKey) return;
    const preferred = defaultSortKeyByFilter[filterKey];
    if (preferred && sorters?.some((s) => s.key === preferred)) {
      setSortKey(preferred);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // ── Resolve active filter / sort ───────────────────────────────────────
  const activeFilter = useMemo(
    () => filters?.find((f) => f.key === filterKey) || null,
    [filters, filterKey]
  );
  const activeSecondary = useMemo(
    () => secondaryFilters?.find((f) => f.key === secondaryFilterKey) || null,
    [secondaryFilters, secondaryFilterKey]
  );
  const activeSort = useMemo(() => sorters?.find((s) => s.key === sortKey) || null, [sorters, sortKey]);

  // ── Pipeline: filter → secondary filter → search → sort ─────────────────
  const filtered = useMemo(() => {
    let list = data;
    if (activeFilter) list = list.filter(activeFilter.predicate);
    if (activeSecondary) list = list.filter(activeSecondary.predicate);
    const q = debouncedSearch.trim().toLowerCase();
    if (q && searchFields && searchFields.length > 0) {
      list = list.filter((item) =>
        searchFields.some((fn) => {
          try {
            return (fn(item) || "").toLowerCase().includes(q);
          } catch {
            return false;
          }
        })
      );
    }
    if (activeSort) {
      list = [...list].sort(activeSort.comparator);
    }
    return list;
  }, [data, activeFilter, activeSecondary, debouncedSearch, searchFields, activeSort]);

  // ── Grouping ────────────────────────────────────────────────────────────
  const groupingActive =
    !!groupBy &&
    (!groupBy.enabledForFilters ||
      (filterKey && groupBy.enabledForFilters.includes(filterKey)));

  const sections = useMemo(() => {
    if (!groupingActive || !groupBy) return null;
    const map = new Map<string, T[]>();
    for (const it of filtered) {
      const k = groupBy.keyExtractor(it);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    const entries = Array.from(map.entries());
    entries.sort(([a], [b]) => (groupBy.sortSections === "desc" ? (a < b ? 1 : -1) : a < b ? -1 : 1));
    return entries.map(([k, items]) => ({ title: groupBy.sectionTitle(k), data: items, key: k }));
  }, [groupingActive, groupBy, filtered]);

  // ── Render helpers ──────────────────────────────────────────────────────
  const renderChipRow = useCallback(
    (chips: FilterChip<T>[], activeKey: string | null, onSelect: (k: string) => void, keyPrefix: string) => (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {chips.map((c) => {
          const active = c.key === activeKey;
          return (
            <TouchableOpacity
              key={c.key}
              onPress={() => onSelect(c.key)}
              style={[styles.chip, active && styles.chipActive]}
              testID={`${keyPrefix}-${c.key}`}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {c.label}
                {typeof c.count === "number" ? ` (${c.count})` : ""}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    ),
    []
  );

  const renderItemInner = useCallback(
    ({ item, index }: { item: T; index: number }) => {
      const child = renderItem(item, index);
      if (!swipeActions || swipeActions.length === 0) return child;
      return <SwipeableRow<T> item={item} child={child} actions={swipeActions} />;
    },
    [renderItem, swipeActions]
  );

  // ── Header (search + filter chips + sort) ───────────────────────────────
  const header = (
    <View style={styles.headerBlock} testID={testID ? `${testID}-header` : undefined}>
      {searchFields && searchFields.length > 0 && (
        <View style={styles.searchBox} testID="filterable-search">
          <Feather name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder={searchPlaceholder || "Szukaj..."}
            placeholderTextColor={colors.textSecondary}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
            testID="filterable-search-input"
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch("")} testID="filterable-search-clear">
              <Feather name="x" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      )}
      {filters && filters.length > 0 && renderChipRow(filters, filterKey, setFilterKey, "filter-chip")}
      {secondaryFilters &&
        secondaryFilters.length > 0 &&
        renderChipRow(secondaryFilters, secondaryFilterKey, setSecondaryFilterKey, "filter2-chip")}
      {sorters && sorters.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow}>
          <View style={styles.sortLabel}>
            <Feather name="bar-chart-2" size={12} color={colors.textSecondary} />
            <Text style={styles.sortLabelText}>Sortuj:</Text>
          </View>
          {sorters.map((s) => {
            const active = s.key === sortKey;
            return (
              <TouchableOpacity
                key={s.key}
                onPress={() => setSortKey(s.key)}
                style={[styles.sortChip, active && styles.sortChipActive]}
                testID={`sort-chip-${s.key}`}
                activeOpacity={0.7}
              >
                <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>{s.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );

  const emptyView = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (emptyState) return emptyState(filterKey);
    return (
      <View style={styles.emptyFallback} testID="filterable-empty">
        <Feather name="inbox" size={28} color={colors.textSecondary} />
        <Text style={styles.emptyText}>Brak wyników</Text>
      </View>
    );
  };

  // ── List render ─────────────────────────────────────────────────────────
  const refreshCtl = onRefresh ? (
    <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} />
  ) : undefined;

  if (sections) {
    return (
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => {
          try {
            return keyExtractor(item);
          } catch {
            return String(index);
          }
        }}
        renderItem={({ item, index }) => renderItemInner({ item, index })}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        ListHeaderComponent={header}
        ListEmptyComponent={emptyView()}
        refreshControl={refreshCtl}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        testID={testID}
        removeClippedSubviews={Platform.OS !== "web"}
      />
    );
  }

  return (
    <FlatList
      data={filtered}
      keyExtractor={keyExtractor}
      renderItem={renderItemInner}
      ListHeaderComponent={header}
      ListEmptyComponent={emptyView()}
      refreshControl={refreshCtl}
      contentContainerStyle={styles.listContent}
      testID={testID}
      removeClippedSubviews={Platform.OS !== "web"}
    />
  );
}

// React.memo through a thin typed wrapper so the generic parameter survives
export const FilterableList = React.memo(FilterableListInner) as typeof FilterableListInner;

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  headerBlock: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 4, gap: 8 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14, padding: 0 },
  chipRow: { paddingVertical: 6, gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.paper,
    marginRight: 6,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.textPrimary },
  chipTextActive: { color: "#fff" },
  sortRow: { alignItems: "center", paddingVertical: 4, gap: 6 },
  sortLabel: { flexDirection: "row", alignItems: "center", gap: 4, marginRight: 6 },
  sortLabelText: { fontSize: 11, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: "700" },
  sortChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.paper,
    marginRight: 6,
  },
  sortChipActive: { backgroundColor: colors.inverted, borderColor: colors.inverted },
  sortChipText: { fontSize: 11, fontWeight: "700", color: colors.textPrimary },
  sortChipTextActive: { color: "#fff" },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    paddingHorizontal: spacing.md,
    paddingTop: 14,
    paddingBottom: 6,
  },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: 40, gap: 10 },
  centered: { alignItems: "center", justifyContent: "center", padding: 40 },
  emptyFallback: { alignItems: "center", padding: 32, gap: 6 },
  emptyText: { fontSize: 13, color: colors.textSecondary },
  swipeActions: { flexDirection: "row", alignItems: "stretch", height: "100%" },
  swipeBtn: {
    width: 68,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 4,
  },
  swipeBtnLabel: { color: "#fff", fontSize: 10, fontWeight: "800", textAlign: "center" },
});
