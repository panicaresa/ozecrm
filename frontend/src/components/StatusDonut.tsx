import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { colors, statusColor, statusLabel } from "../theme";

interface Props {
  data: Record<string, number>;
  size?: number;
  thickness?: number;
  testID?: string;
}

export const StatusDonut: React.FC<Props> = ({ data, size = 180, thickness = 26, testID }) => {
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
                const circ = (
                  <Circle
                    key={key}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke={statusColor[key] || colors.primary}
                    strokeWidth={thickness}
                    fill="none"
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                    strokeLinecap="butt"
                  />
                );
                offset += len;
                return circ;
              })}
          </G>
        </Svg>
        <View style={styles.center} pointerEvents="none">
          <Text style={styles.total}>{total}</Text>
          <Text style={styles.subTotal}>leadów</Text>
        </View>
      </View>

      <View style={styles.legend}>
        {Object.keys(data).map((k) => (
          <View style={styles.legendItem} key={k}>
            <View style={[styles.dot, { backgroundColor: statusColor[k] || colors.primary }]} />
            <Text style={styles.legendLabel}>{statusLabel[k] || k}</Text>
            <Text style={styles.legendCount}>{data[k] || 0}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 20 },
  center: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" },
  total: { fontSize: 28, fontWeight: "900", color: colors.textPrimary },
  subTotal: { fontSize: 11, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  legend: { flex: 1, gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: "500" },
  legendCount: { color: colors.textSecondary, fontSize: 13, fontWeight: "700" },
});
