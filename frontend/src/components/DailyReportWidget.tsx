import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, radius, spacing } from "../theme";
import { api, formatApiError } from "../lib/api";
import { fmtPln } from "../lib/offerEngine";
import { useAuth } from "../lib/auth";
import { DrillDownableSection } from "./DrillDownableSection";

// ──────────────────────────────────────────────────────────────────────────────
// Types matching the GET /api/reports/daily response shape (server.py ~1811)
// ──────────────────────────────────────────────────────────────────────────────
type Alert = {
  severity: "critical" | "warning" | "info";
  type: string;
  message: string;
  meta?: Record<string, any>;
};

interface DailyReport {
  period: "today" | "yesterday";
  period_date: string;
  generated_at: string;
  scope: "firm" | "team";
  scope_name: string;
  contracts_signed: {
    count: number;
    total_gross: number;
    total_margin: number;
    total_commission: number;
    avg_gross: number;
  };
  contracts_cancelled: {
    count: number;
    total_gross_lost: number;
    list: { contract_id: string; client_name: string; cancelled_at?: string }[];
  };
  negative_margin_contracts: {
    contract_id: string;
    client_name: string;
    margin: number;
    override_by?: string;
  }[];
  comparison: {
    yesterday: { contracts: number; margin: number };
    week_avg: { contracts: number; margin: number };
  };
  meetings_tomorrow: {
    count: number;
    list: {
      lead_id: string;
      client_name: string;
      meeting_at: string;
      rep_id?: string;
      rep_name: string;
    }[];
  };
  hot_leads: {
    count: number;
    list: {
      lead_id: string;
      client_name: string;
      rep_id?: string;
      rep_name: string;
      phone?: string;
      address?: string;
    }[];
  };
  new_leads_added: {
    count: number;
    by_rep: {
      rep_id?: string | null;
      rep_name: string;
      count: number;
      leads?: { id: string; client_name?: string; created_at?: string }[];
    }[];
  };
  top_rep?: {
    rep_id: string;
    rep_name: string;
    margin_today: number;
    contracts_today: number;
    medal: string;
  } | null;
  top3_reps: {
    rep_id: string;
    rep_name: string;
    margin_today: number;
    contracts_today: number;
    medal: string;
  }[];
  team_activity: {
    total_reps: number;
    active_reps: number;
    inactive_reps: number;
    inactive_list: {
      rep_id: string;
      rep_name: string;
      last_active_days_ago: number;
    }[];
  };
  per_manager_breakdown?:
    | {
        manager_id: string;
        manager_name: string;
        reps_count: number;
        contracts_today: number;
        margin_today: number;
        active_reps: number;
        inactive_reps: number;
      }[]
    | null;
  alerts: Alert[];
}

interface Props {
  testID?: string;
  /** If true, widget is expanded by default (default: false — collapsed). */
  defaultExpanded?: boolean;
  /** Silent auto-refresh interval in ms (default 60 s). Pass 0 to disable. */
  refreshIntervalMs?: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
const fmtInt = (n: number | undefined | null) =>
  typeof n === "number" && isFinite(n) ? n.toLocaleString("pl-PL") : "0";

const fmtDate = (iso: string) => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("pl-PL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    return iso;
  }
};

const fmtShortDate = (iso: string) => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
};

const fmtTime = (iso: string) => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

const fmtDateTime = (iso: string) => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("pl-PL", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const diffLabel = (current: number, reference: number) => {
  if (!reference && !current) return { text: "—", color: colors.textSecondary, icon: "minus" as const };
  if (!reference) return { text: `+${fmtInt(current)}`, color: colors.success, icon: "arrow-up" as const };
  const delta = current - reference;
  if (delta === 0) return { text: "0", color: colors.textSecondary, icon: "minus" as const };
  const sign = delta > 0 ? "+" : "";
  return {
    text: `${sign}${fmtInt(delta)}`,
    color: delta > 0 ? colors.success : colors.error,
    icon: (delta > 0 ? "arrow-up" : "arrow-down") as "arrow-up" | "arrow-down",
  };
};

const diffPctLabel = (current: number, reference: number) => {
  if (!reference) {
    return {
      text: current > 0 ? "+100%" : "—",
      color: current > 0 ? colors.success : colors.textSecondary,
    };
  }
  const pct = Math.round(((current - reference) / reference) * 100);
  if (pct === 0) return { text: "0%", color: colors.textSecondary };
  return {
    text: `${pct > 0 ? "+" : ""}${pct}%`,
    color: pct > 0 ? colors.success : colors.error,
  };
};

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────
export function DailyReportWidget({
  testID = "daily-report-widget",
  defaultExpanded = false,
  refreshIntervalMs = 60000,
}: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const role = user?.role;

  // Route helpers — keep URLs role-aware. Admin uses manager routes for lead
  // detail / rep profile (no dedicated admin pages yet — TODO Sprint 3.5c).
  const leadDetailHref = useCallback(
    (leadId: string): string => {
      if (role === "manager" || role === "admin") return `/(manager)/lead/${leadId}`;
      return `/(rep)/lead/${leadId}`;
    },
    [role]
  );
  const repProfileHref = useCallback(
    (repId: string): string => {
      // Sprint 3.5c micro: admin now has its own rep profile route with
      // breadcrumbs + manager info. Manager keeps the existing route.
      if (role === "admin") return `/(admin)/rep/${repId}`;
      return `/(manager)/rep/${repId}`;
    },
    [role]
  );
  const managerLeadsWithFilter = useCallback(
    (repId: string) => ({
      pathname: "/(manager)/leads" as const,
      params: { rep_id: repId, created_today: "1" },
    }),
    []
  );

  const [expanded, setExpanded] = useState<boolean>(!!defaultExpanded);
  const [period, setPeriod] = useState<"today" | "yesterday">("today");
  const [data, setData] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        if (data == null) setLoading(true);
        else setRefreshing(true);
      }
      setErr(null);
      try {
        const res = await api.get<DailyReport>("/reports/daily", { params: { period } });
        setData(res.data);
        setLastRefreshedAt(new Date());
      } catch (e: any) {
        // 403 means non-manager/non-admin (e.g. handlowiec). Widget is hidden silently
        // by the parent screen, but in case it is rendered we still show a message.
        setErr(formatApiError(e, "Nie udało się pobrać raportu dziennego"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [period, data]
  );

  useEffect(() => {
    load();
    // Don't run the interval if widget is disabled
    if (!refreshIntervalMs || refreshIntervalMs <= 0) return;
    const t = setInterval(() => {
      load({ silent: true });
    }, refreshIntervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, refreshIntervalMs]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const criticalAlerts = useMemo(
    () => (data?.alerts || []).filter((a) => a.severity === "critical"),
    [data]
  );
  const warningAlerts = useMemo(
    () => (data?.alerts || []).filter((a) => a.severity === "warning"),
    [data]
  );

  const marginDelta = useMemo(() => {
    if (!data) return null;
    return diffLabel(
      data.contracts_signed.total_margin,
      data.comparison.yesterday.margin
    );
  }, [data]);

  const weekPct = useMemo(() => {
    if (!data) return null;
    return diffPctLabel(
      data.contracts_signed.total_margin,
      data.comparison.week_avg.margin
    );
  }, [data]);

  // ──────────────────────────────────────────────────────────────────────────
  // Render: loading state (collapsed skeleton)
  // ──────────────────────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <View style={styles.card} testID={testID}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={[styles.iconCircle, { backgroundColor: `${colors.primary}15` }]}>
              <Feather name="bar-chart-2" size={16} color={colors.primary} />
            </View>
            <Text style={styles.title}>Raport dzienny</Text>
          </View>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      </View>
    );
  }

  // Error state (e.g. 403 for handlowiec) — widget hides itself to save space.
  if (err && !data) {
    return (
      <View style={styles.card} testID={`${testID}-error`}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={[styles.iconCircle, { backgroundColor: `${colors.error}15` }]}>
              <Feather name="alert-circle" size={16} color={colors.error} />
            </View>
            <Text style={styles.title}>Raport dzienny</Text>
          </View>
          <TouchableOpacity onPress={() => load()} hitSlop={10} testID={`${testID}-retry`}>
            <Feather name="rotate-cw" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.errText}>{err}</Text>
      </View>
    );
  }

  if (!data) return null;

  const totalAlerts = (data.alerts || []).length;

  // ──────────────────────────────────────────────────────────────────────────
  // Collapsed summary row
  // ──────────────────────────────────────────────────────────────────────────
  const renderCollapsed = () => (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => setExpanded(true)}
      testID={`${testID}-header-collapsed`}
      style={styles.headerRow}
    >
      <View style={styles.headerLeft}>
        <View style={[styles.iconCircle, { backgroundColor: `${colors.primary}15` }]}>
          <Feather name="bar-chart-2" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Raport dzienny</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {period === "today" ? "Dziś" : "Wczoraj"} · {fmtShortDate(data.period_date)}
            {data.scope_name ? ` · ${data.scope_name}` : ""}
          </Text>
        </View>
      </View>
      {totalAlerts > 0 && (
        <View style={styles.alertPill} testID={`${testID}-alert-badge`}>
          <Feather name="alert-triangle" size={11} color="#fff" />
          <Text style={styles.alertPillText}>{totalAlerts}</Text>
        </View>
      )}
      <Feather name="chevron-down" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  // Inline 3-metric preview (shown when collapsed)
  const renderMiniMetrics = () => (
    <View style={styles.miniRow} testID={`${testID}-mini-metrics`}>
      <View style={styles.miniCell}>
        <Text style={styles.miniValue}>{fmtInt(data.contracts_signed.count)}</Text>
        <Text style={styles.miniLabel}>Umowy</Text>
      </View>
      <View style={styles.miniDivider} />
      <View style={styles.miniCell}>
        <Text style={[styles.miniValue, { color: colors.secondary }]}>
          {fmtPln(data.contracts_signed.total_margin)}
        </Text>
        <Text style={styles.miniLabel}>Marża</Text>
      </View>
      <View style={styles.miniDivider} />
      <View style={styles.miniCell}>
        <Text style={styles.miniValue} numberOfLines={1}>
          {data.top_rep ? `${data.top_rep.medal} ${data.top_rep.rep_name.split(" ")[0]}` : "—"}
        </Text>
        <Text style={styles.miniLabel}>Lider</Text>
      </View>
    </View>
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Expanded blocks
  // ──────────────────────────────────────────────────────────────────────────
  const renderExpandedHeader = () => (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => setExpanded(false)}
      testID={`${testID}-header-expanded`}
      style={styles.headerRow}
    >
      <View style={styles.headerLeft}>
        <View style={[styles.iconCircle, { backgroundColor: `${colors.primary}15` }]}>
          <Feather name="bar-chart-2" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Raport dzienny</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {fmtDate(data.period_date)} · {data.scope_name}
          </Text>
        </View>
      </View>
      {refreshing && <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 6 }} />}
      <Feather name="chevron-up" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  const renderPeriodToggle = () => (
    <View style={styles.periodToggleRow}>
      {(["today", "yesterday"] as const).map((p) => (
        <TouchableOpacity
          key={p}
          activeOpacity={0.85}
          onPress={() => setPeriod(p)}
          style={[styles.periodChip, period === p && styles.periodChipActive]}
          testID={`${testID}-period-${p}`}
        >
          <Text
            style={[
              styles.periodChipText,
              period === p && { color: colors.textInverse },
            ]}
          >
            {p === "today" ? "Dziś" : "Wczoraj"}
          </Text>
        </TouchableOpacity>
      ))}
      <View style={{ flex: 1 }} />
      <TouchableOpacity
        onPress={() => load()}
        hitSlop={8}
        testID={`${testID}-refresh`}
        style={styles.refreshBtn}
      >
        <Feather name="rotate-cw" size={12} color={colors.textSecondary} />
        <Text style={styles.refreshText}>
          {lastRefreshedAt ? fmtTime(lastRefreshedAt.toISOString()) : "—"}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // Block A — Pieniądze
  const renderBlockMoney = () => {
    const cs = data.contracts_signed;
    const cc = data.contracts_cancelled;
    return (
      <View style={styles.block} testID={`${testID}-block-money`}>
        <View style={styles.blockHead}>
          <Feather name="dollar-sign" size={14} color={colors.success} />
          <Text style={styles.blockTitle}>Pieniądze</Text>
        </View>

        <View style={styles.moneyGrid}>
          <View style={styles.moneyCell}>
            <Text style={styles.moneyValue}>{fmtInt(cs.count)}</Text>
            <Text style={styles.moneyLabel}>Umowy podpisane</Text>
          </View>
          <View style={styles.moneyCell}>
            <Text style={[styles.moneyValue, { color: colors.secondary }]}>{fmtPln(cs.total_margin)}</Text>
            <Text style={styles.moneyLabel}>Marża łączna</Text>
          </View>
        </View>

        <View style={styles.moneyGrid}>
          <View style={styles.moneyCell}>
            <Text style={styles.moneyValueSm}>{fmtPln(cs.total_gross)}</Text>
            <Text style={styles.moneyLabel}>Obrót brutto</Text>
          </View>
          <View style={styles.moneyCell}>
            <Text style={styles.moneyValueSm}>{fmtPln(cs.total_commission)}</Text>
            <Text style={styles.moneyLabel}>Prowizja</Text>
          </View>
        </View>

        {cs.count > 0 && (
          <View style={styles.avgRow}>
            <Feather name="trending-up" size={12} color={colors.textSecondary} />
            <Text style={styles.avgText}>Śr. umowa: {fmtPln(cs.avg_gross)}</Text>
          </View>
        )}

        {/* Comparison row */}
        <View style={styles.comparisonRow}>
          <View style={styles.comparisonCell}>
            <Text style={styles.comparisonLabel}>vs Wczoraj</Text>
            <View style={styles.comparisonValueRow}>
              {marginDelta && (
                <>
                  <Feather name={marginDelta.icon} size={12} color={marginDelta.color} />
                  <Text style={[styles.comparisonValue, { color: marginDelta.color }]}>
                    {marginDelta.text === "0" ? "bez zmian" : marginDelta.text.includes("-") || marginDelta.text.includes("+") ? `${marginDelta.text} PLN` : marginDelta.text}
                  </Text>
                </>
              )}
            </View>
            <Text style={styles.comparisonSub}>
              {fmtInt(data.comparison.yesterday.contracts)} umów · {fmtPln(data.comparison.yesterday.margin)}
            </Text>
          </View>
          <View style={styles.comparisonCell}>
            <Text style={styles.comparisonLabel}>vs Śr. 7 dni</Text>
            <View style={styles.comparisonValueRow}>
              {weekPct && (
                <Text style={[styles.comparisonValue, { color: weekPct.color }]}>{weekPct.text}</Text>
              )}
            </View>
            <Text style={styles.comparisonSub}>
              {data.comparison.week_avg.contracts.toFixed(1)} umów/d · {fmtPln(data.comparison.week_avg.margin)}
            </Text>
          </View>
        </View>

        {/* Cancelled & negative margin */}
        {cc.count > 0 && (
          <View style={[styles.microAlertRow, { backgroundColor: `${colors.error}10` }]}>
            <Feather name="x-circle" size={13} color={colors.error} />
            <Text style={[styles.microAlertText, { color: colors.error }]} numberOfLines={2}>
              {cc.count} {cc.count === 1 ? "umowa anulowana" : "anulowanych umów"}
              {cc.total_gross_lost > 0 ? ` · strata ${fmtPln(cc.total_gross_lost)}` : ""}
            </Text>
          </View>
        )}
        {data.negative_margin_contracts.length > 0 && (
          <View style={[styles.microAlertRow, { backgroundColor: `${colors.error}10` }]}>
            <Feather name="alert-octagon" size={13} color={colors.error} />
            <Text style={[styles.microAlertText, { color: colors.error }]} numberOfLines={2}>
              {data.negative_margin_contracts.length} {data.negative_margin_contracts.length === 1 ? "umowa z ujemną marżą" : "umów z ujemną marżą"}
            </Text>
          </View>
        )}
      </View>
    );
  };

  // Block B — Pipeline (drill-downs)
  const renderBlockPipeline = () => {
    const mt = data.meetings_tomorrow;
    const hl = data.hot_leads;
    const nl = data.new_leads_added;
    const anyContent = mt.count > 0 || hl.count > 0 || nl.count > 0;

    // Normalize items for DrillDownableSection.
    const meetingItems = mt.list.map((m) => ({ id: m.lead_id, ...m }));
    const hotItems = hl.list.map((l) => ({ id: l.lead_id, ...l }));
    const newByRepItems = nl.by_rep
      .filter((r) => !!r.rep_id) // exclude unassigned bucket
      .map((r) => ({ id: r.rep_id as string, ...r }));

    return (
      <View style={styles.block} testID={`${testID}-block-pipeline`}>
        <View style={styles.blockHead}>
          <Feather name="target" size={14} color={colors.info} />
          <Text style={styles.blockTitle}>Pipeline</Text>
        </View>

        <View style={styles.pipelineGrid}>
          <View style={styles.pipelineCell}>
            <Text style={styles.pipelineValue}>{fmtInt(mt.count)}</Text>
            <Text style={styles.pipelineLabel}>Spotkania jutro</Text>
          </View>
          <View style={styles.pipelineCell}>
            <Text style={styles.pipelineValue}>{fmtInt(hl.count)}</Text>
            <Text style={styles.pipelineLabel}>Gorące leady</Text>
          </View>
          <View style={styles.pipelineCell}>
            <Text style={styles.pipelineValue}>{fmtInt(nl.count)}</Text>
            <Text style={styles.pipelineLabel}>Nowe leady</Text>
          </View>
        </View>

        {meetingItems.length > 0 && (
          <DrillDownableSection
            testID={`${testID}-drill-meetings`}
            title="Najbliższe spotkania"
            icon="calendar"
            iconColor={colors.info}
            items={meetingItems}
            renderItemPreview={(m) => (
              <View style={styles.ddRow}>
                <Text style={styles.ddTime}>{fmtTime(m.meeting_at)}</Text>
                <Text style={styles.ddClient} numberOfLines={1}>
                  {m.client_name}
                </Text>
                <Text style={styles.ddSub} numberOfLines={1}>
                  {m.rep_name}
                </Text>
              </View>
            )}
            renderItemFull={(m) => (
              <View>
                <Text style={styles.ddClientBig} numberOfLines={1}>
                  {m.client_name}
                </Text>
                <Text style={styles.ddSub}>
                  {fmtDateTime(m.meeting_at)} · Handlowiec: {m.rep_name}
                </Text>
              </View>
            )}
            onItemPress={(m) => router.push(leadDetailHref(m.lead_id) as never)}
            emptyCopy="Brak zaplanowanych spotkań"
            modalTitle="Spotkania jutro"
          />
        )}

        {hotItems.length > 0 && (
          <DrillDownableSection
            testID={`${testID}-drill-hot`}
            title="Decyzja klienta"
            icon="zap"
            iconColor={colors.accent}
            items={hotItems}
            renderItemPreview={(l) => (
              <View style={styles.ddRow}>
                <Text style={styles.ddClient} numberOfLines={1}>
                  {l.client_name}
                </Text>
                <Text style={styles.ddSub} numberOfLines={1}>
                  {l.rep_name}
                </Text>
              </View>
            )}
            renderItemFull={(l) => (
              <View>
                <Text style={styles.ddClientBig} numberOfLines={1}>
                  {l.client_name}
                </Text>
                <Text style={styles.ddSub} numberOfLines={1}>
                  {l.address ? `${l.address} · ` : ""}{l.rep_name}
                </Text>
              </View>
            )}
            onItemPress={(l) => router.push(leadDetailHref(l.lead_id) as never)}
            modalTitle="Gorące leady (Decyzja)"
          />
        )}

        {newByRepItems.length > 0 && (
          <DrillDownableSection
            testID={`${testID}-drill-new`}
            title="Nowe leady wg handlowca"
            icon="user-plus"
            iconColor={colors.secondary}
            items={newByRepItems}
            layout="chips"
            maxInline={6}
            renderItemPreview={(g) => (
              <View style={styles.newLeadChip}>
                <Text style={styles.newLeadChipText}>
                  {(g.rep_name || "—").split(" ")[0]}:{" "}
                  <Text style={{ fontWeight: "900", color: colors.secondary }}>
                    {g.count}
                  </Text>
                </Text>
              </View>
            )}
            renderItemFull={(g) => (
              <View>
                <Text style={styles.ddClientBig} numberOfLines={1}>
                  {g.rep_name}
                </Text>
                <Text style={styles.ddSub}>
                  {g.count} {g.count === 1 ? "nowy lead" : "nowych leadów"} dziś
                </Text>
              </View>
            )}
            onItemPress={(g) =>
              router.push(managerLeadsWithFilter(g.rep_id as string) as never)
            }
            modalTitle="Nowe leady dziś"
          />
        )}

        {!anyContent && <Text style={styles.blockEmpty}>Brak aktywności w pipeline</Text>}
      </View>
    );
  };

  // Block C — Zespół
  const renderBlockTeam = () => {
    const ta = data.team_activity;
    // Filter out never-active reps (last_active_days_ago >= 999) — those are "new",
    // not "inactive". They still count in total_reps, but don't belong here.
    const inactiveReal = (ta.inactive_list || []).filter(
      (r) => r.last_active_days_ago < 999
    );
    return (
      <View style={styles.block} testID={`${testID}-block-team`}>
        <View style={styles.blockHead}>
          <Feather name="users" size={14} color={colors.primary} />
          <Text style={styles.blockTitle}>Zespół</Text>
        </View>

        <View style={styles.teamStatsRow}>
          <View style={styles.teamStatCell}>
            <Text style={styles.teamStatValue}>{fmtInt(ta.total_reps)}</Text>
            <Text style={styles.teamStatLabel}>Handlowców</Text>
          </View>
          <View style={styles.teamStatCell}>
            <Text style={[styles.teamStatValue, { color: colors.success }]}>
              {fmtInt(ta.active_reps)}
            </Text>
            <Text style={styles.teamStatLabel}>Aktywnych</Text>
          </View>
          <View style={styles.teamStatCell}>
            <Text
              style={[
                styles.teamStatValue,
                { color: ta.inactive_reps > 0 ? colors.error : colors.textSecondary },
              ]}
            >
              {fmtInt(ta.inactive_reps)}
            </Text>
            <Text style={styles.teamStatLabel}>Nieaktywnych</Text>
          </View>
        </View>

        {data.top3_reps.length > 0 && (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.subBlockTitle}>Top handlowcy</Text>
            {data.top3_reps.map((r) => (
              <Pressable
                key={r.rep_id}
                onPress={() => router.push(repProfileHref(r.rep_id) as never)}
                style={({ pressed }) => [
                  styles.podiumRow,
                  pressed && { opacity: 0.6 },
                ]}
                accessibilityRole="button"
                testID={`${testID}-top-${r.rep_id}`}
              >
                <Text style={styles.podiumMedal}>{r.medal}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.podiumName} numberOfLines={1}>
                    {r.rep_name}
                  </Text>
                  <Text style={styles.podiumSub}>
                    {r.contracts_today} {r.contracts_today === 1 ? "umowa" : "umów"} · {fmtPln(r.margin_today)}
                  </Text>
                </View>
                <Feather name="chevron-right" size={14} color={colors.textSecondary} />
              </Pressable>
            ))}
          </View>
        )}

        {inactiveReal.length > 0 && (
          <DrillDownableSection
            testID={`${testID}-drill-inactive`}
            title="Nieaktywni > 3 dni"
            icon="user-x"
            iconColor={colors.error}
            items={inactiveReal.map((r) => ({ id: r.rep_id, ...r }))}
            layout="chips"
            maxInline={6}
            renderItemPreview={(r) => (
              <View style={styles.inactiveChip}>
                <Feather name="user-x" size={10} color={colors.error} />
                <Text style={styles.inactiveChipText}>
                  {(r.rep_name || "—").split(" ")[0]}: {r.last_active_days_ago}d
                </Text>
              </View>
            )}
            renderItemFull={(r) => (
              <View>
                <Text style={styles.ddClientBig} numberOfLines={1}>
                  {r.rep_name}
                </Text>
                <Text style={styles.ddSub}>
                  Ostatnia aktywność: {r.last_active_days_ago} dni temu
                </Text>
              </View>
            )}
            onItemPress={(r) => router.push(repProfileHref(r.rep_id) as never)}
            emptyCopy="Wszyscy aktywni 🎉"
            modalTitle="Nieaktywni handlowcy"
          />
        )}

        {data.top3_reps.length === 0 && ta.total_reps === 0 && (
          <Text style={styles.blockEmpty}>Brak handlowców w zespole</Text>
        )}
      </View>
    );
  };

  // Per-manager breakdown (admin only)
  const renderPerManager = () => {
    const list = data.per_manager_breakdown;
    if (!list || list.length === 0) return null;
    return (
      <View style={styles.block} testID={`${testID}-per-manager`}>
        <View style={styles.blockHead}>
          <Feather name="briefcase" size={14} color={colors.inverted} />
          <Text style={styles.blockTitle}>Managerowie</Text>
        </View>
        {list.map((m) => (
          <View key={m.manager_id} style={styles.mgrRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.mgrName} numberOfLines={1}>
                {m.manager_name}
              </Text>
              <Text style={styles.mgrSub}>
                {m.reps_count} {m.reps_count === 1 ? "handlowiec" : "handlowców"} · akt. {m.active_reps}/{m.reps_count}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.mgrMargin}>{fmtPln(m.margin_today)}</Text>
              <Text style={styles.mgrSub}>
                {m.contracts_today} {m.contracts_today === 1 ? "umowa" : "umów"}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  // Alerts
  const renderAlerts = () => {
    if (!totalAlerts) return null;
    const allAlerts = [...criticalAlerts, ...warningAlerts];
    return (
      <View style={styles.block} testID={`${testID}-alerts`}>
        <View style={styles.blockHead}>
          <Feather name="alert-triangle" size={14} color={colors.error} />
          <Text style={styles.blockTitle}>Alerty ({totalAlerts})</Text>
        </View>
        {allAlerts.slice(0, 6).map((a, i) => {
          const isCritical = a.severity === "critical";
          const bg = isCritical ? `${colors.error}12` : `${colors.warning}15`;
          const fg = isCritical ? colors.error : colors.warning;
          return (
            <View key={`${a.type}-${i}`} style={[styles.alertRow, { backgroundColor: bg }]}>
              <Feather
                name={isCritical ? "alert-octagon" : "alert-circle"}
                size={13}
                color={fg}
              />
              <Text style={[styles.alertText, { color: fg }]} numberOfLines={3}>
                {a.message}
              </Text>
            </View>
          );
        })}
        {allAlerts.length > 6 && (
          <Text style={styles.moreText}>+{allAlerts.length - 6} więcej alertów</Text>
        )}
      </View>
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.card} testID={testID}>
      {expanded ? renderExpandedHeader() : renderCollapsed()}

      {!expanded && renderMiniMetrics()}

      {expanded && (
        <View style={{ marginTop: 4 }}>
          {renderPeriodToggle()}
          {renderBlockMoney()}
          {renderBlockPipeline()}
          {renderBlockTeam()}
          {renderPerManager()}
          {renderAlerts()}
          {err && (
            <View style={styles.inlineErr}>
              <Text style={styles.inlineErrText}>{err}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Styles — match Manager Dashboard & FinanceScreen (paper card + border)
// ──────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Drill-down row/chip local styles (Sprint 3.5b)
  ddRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  ddTime: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.info,
    minWidth: 42,
    fontVariant: ["tabular-nums"],
  },
  ddClient: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  ddClientBig: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  ddSub: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "600",
    marginTop: 2,
  },
  newLeadChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: `${colors.secondary}30`,
    backgroundColor: `${colors.secondary}10`,
  },
  newLeadChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  inactiveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: `${colors.error}30`,
    backgroundColor: `${colors.error}10`,
  },
  inactiveChipText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.error,
  },
  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 15,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "600",
    marginTop: 1,
    textTransform: "capitalize",
  },

  alertPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.error,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  alertPillText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
  },

  // Mini metrics (collapsed preview)
  miniRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.zinc100,
  },
  miniCell: { flex: 1, alignItems: "center" },
  miniDivider: { width: 1, height: 32, backgroundColor: colors.zinc100 },
  miniValue: {
    fontSize: 15,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: -0.3,
    maxWidth: "100%",
  },
  miniLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 2,
  },

  // Period toggle
  periodToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  periodChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.paper,
  },
  periodChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  periodChipText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
    letterSpacing: 0.3,
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  refreshText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "700",
  },

  // Blocks
  block: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.zinc100,
  },
  blockHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  blockTitle: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  blockEmpty: {
    color: colors.textSecondary,
    fontSize: 12,
    paddingVertical: 6,
    fontStyle: "italic",
  },

  // Money block
  moneyGrid: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: 4,
  },
  moneyCell: {
    flex: 1,
    backgroundColor: colors.zinc100,
    borderRadius: radius.md,
    padding: 10,
  },
  moneyValue: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  moneyValueSm: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  moneyLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 3,
  },
  avgRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  avgText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  comparisonRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: 10,
  },
  comparisonCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
  },
  comparisonLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  comparisonValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  comparisonValue: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  comparisonSub: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 3,
    fontWeight: "600",
  },
  microAlertRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: radius.sm,
    marginTop: 8,
  },
  microAlertText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },

  // Pipeline
  pipelineGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  pipelineCell: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.zinc100,
    borderRadius: radius.md,
    paddingVertical: 10,
  },
  pipelineValue: {
    fontSize: 20,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  pipelineLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 3,
  },
  subBlockTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc100,
  },
  listPrimary: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  listSecondary: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "600",
    maxWidth: "50%",
    textAlign: "right",
  },
  moreText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontStyle: "italic",
    marginTop: 4,
    textAlign: "center",
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  miniChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.paper,
  },
  miniChipText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textPrimary,
  },

  // Team
  teamStatsRow: { flexDirection: "row", gap: spacing.sm },
  teamStatCell: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.zinc100,
    borderRadius: radius.md,
    paddingVertical: 10,
  },
  teamStatValue: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  teamStatLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 3,
  },
  podiumRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc100,
  },
  podiumMedal: { fontSize: 20 },
  podiumName: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  podiumSub: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "600",
    marginTop: 1,
  },

  // Per-manager
  mgrRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc100,
  },
  mgrName: { fontSize: 13, fontWeight: "800", color: colors.textPrimary },
  mgrSub: { fontSize: 11, color: colors.textSecondary, fontWeight: "600", marginTop: 1 },
  mgrMargin: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.secondary,
    letterSpacing: -0.3,
  },

  // Alerts block
  alertRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: radius.sm,
    marginBottom: 6,
  },
  alertText: { flex: 1, fontSize: 12, fontWeight: "700" },

  // Error
  errText: {
    fontSize: 12,
    color: colors.error,
    marginTop: 6,
    fontWeight: "600",
  },
  inlineErr: {
    padding: 10,
    backgroundColor: `${colors.error}10`,
    borderRadius: radius.sm,
    marginTop: 10,
  },
  inlineErrText: {
    color: colors.error,
    fontSize: 12,
    fontWeight: "700",
  },
});

export default DailyReportWidget;
