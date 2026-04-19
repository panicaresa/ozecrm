import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { colors, statusColor, statusLabel } from "../theme";

interface Props {
  data: Record<string, number>;
  size?: number;
  thickness?: number;
  testID?: string;
  selected?: string | null;
  onSelect?: (key: string | null) => void;
}

export const StatusDonut: React.FC<Props> = ({ data, size = 180, thickness = 26, testID, selected, onSelect }) => {
  const entries = Object.entries(data).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <G rotation={-90} originX={size / 2} originY={size / 2}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.zinc200} strokeWidth={thickness} fill="none" />
            {total > 0 &&
              entries.map(([key, value]) => {
                const frac = value / total;
                const len = c * frac;
                const dash = `${len} ${c - len}`;
                const dim = selected && selected !== key ? 0.25 : 1;
                const circ = (
                  <Circle
                    key={key}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke={statusColor[key] || colors.primary}
                    strokeWidth={selected === key ? thickness + 4 : thickness}
                    fill="none"
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                    strokeLinecap="butt"
                    opacity={dim}
                  />
                );
                offset += len;
                return circ;
              })}
          </G>
        </Svg>
        <View style={styles.center} pointerEvents="none">
          <Text style={styles.total}>{selected ? data[selected] || 0 : total}</Text>
          <Text style={styles.subTotal}>{selected ? statusLabel[selected] : "leadów"}</Text>
        </View>
      </View>

      <View style={styles.legend}>
        {Object.keys(data).map((k) => {
          const active = selected === k;
          return (
            <TouchableOpacity
              style={[styles.legendItem, active && styles.legendItemActive]}
              key={k}
              onPress={() => onSelect?.(active ? null : k)}
              activeOpacity={0.7}
              testID={`donut-legend-${k}`}
            >
              <View style={[styles.dot, { backgroundColor: statusColor[k] || colors.primary }]} />
              <Text style={[styles.legendLabel, active && { color: colors.textPrimary, fontWeight: "800" }]}>
                {statusLabel[k] || k}
              </Text>
              <Text style={styles.legendCount}>{data[k] || 0}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 20 },
  center: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" },
  total: { fontSize: 28, fontWeight: "900", color: colors.textPrimary },
  subTotal: { fontSize: 11, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  legend: { flex: 1, gap: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6 },
  legendItemActive: { backgroundColor: colors.zinc100 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: "500" },
  legendCount: { color: colors.textSecondary, fontSize: 13, fontWeight: "700" },
});
