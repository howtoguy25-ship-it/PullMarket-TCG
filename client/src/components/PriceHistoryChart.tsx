import React, { useState } from "react";
import { View, StyleSheet, Text, LayoutChangeEvent } from "react-native";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Polyline, Polygon, Circle, Line } from "react-native-svg";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { formatPriceCents } from "@/lib/format";

export interface PriceHistoryPoint {
  priceCents: number;
  priceAudCents: number;
  date: string;
}

const CHART_HEIGHT = 120;
const PADDING_Y = 14;

/** A compact, real-data line chart of a card's market price over the last
 * ~7 days (JustTCG's history granularity) — gradient fill under the line,
 * an accent dot on the latest point, min/max labels. Renders nothing
 * useful with fewer than 2 points (a flat single dot isn't a "chart"),
 * so the caller should only mount this once `history.length >= 2`. */
export function PriceHistoryChart({ history, accentColor = Colors.primary, trendUp }: { history: PriceHistoryPoint[]; accentColor?: string; trendUp: boolean | null }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (history.length < 2 || width === 0) {
    return <View style={styles.chartArea} onLayout={onLayout} />;
  }

  const prices = history.map((p) => p.priceAudCents);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;
  const usableHeight = CHART_HEIGHT - PADDING_Y * 2;

  const points = history.map((p, i) => {
    const x = (i / (history.length - 1)) * width;
    const y = PADDING_Y + usableHeight - ((p.priceAudCents - minPrice) / range) * usableHeight;
    return { x, y };
  });
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");
  const fillPoints = `0,${CHART_HEIGHT} ${polylinePoints} ${width},${CHART_HEIGHT}`;
  const lineColor = trendUp === false ? Colors.danger : trendUp === true ? Colors.success : accentColor;
  const last = points[points.length - 1];

  return (
    <View style={styles.chartArea} onLayout={onLayout}>
      <Svg width={width} height={CHART_HEIGHT}>
        <Defs>
          <SvgLinearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={lineColor} stopOpacity={0.28} />
            <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
          </SvgLinearGradient>
        </Defs>
        <Line x1={0} y1={PADDING_Y + usableHeight / 2} x2={width} y2={PADDING_Y + usableHeight / 2} stroke={Colors.border} strokeWidth={1} strokeDasharray="3,4" />
        <Polygon points={fillPoints} fill="url(#priceFill)" />
        <Polyline points={polylinePoints} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={last.x} cy={last.y} r={4.5} fill={lineColor} stroke={Colors.white} strokeWidth={2} />
      </Svg>
      <View style={styles.axisLabels}>
        <Text style={styles.axisLabel}>{formatPriceCents(minPrice, "AU$")}</Text>
        <Text style={styles.axisLabel}>{formatPriceCents(maxPrice, "AU$")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chartArea: { width: "100%", height: CHART_HEIGHT, position: "relative" },
  axisLabels: { position: "absolute", left: 0, right: 0, bottom: -18, flexDirection: "row", justifyContent: "space-between" },
  axisLabel: { ...Typography.small, fontSize: 10, color: Colors.textMuted },
});
