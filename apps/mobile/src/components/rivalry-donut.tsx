import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';

import { donutSegments, type DonutSlice } from '@/lib/rivalries';
import { Colors, Spacing, Typography } from '@/theme';

export const DONUT_COLORS = [
  '#660000',
  '#CC0000',
  '#990000',
  '#FF0000',
  '#FF3333',
  '#FF6666',
  '#FF9999',
] as const;

const HEIGHT = 250;
const RADIUS = HEIGHT / 3;
const STROKE = HEIGHT / 6;
const LABEL_RADIUS = RADIUS + STROKE / 2 + 18;
const ANIMATION_MS = 1500;
const LABEL_FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

function useSweepProgress(animate: boolean): number {
  const [progress, setProgress] = useState(animate ? 0 : 1);
  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    const startedAt = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - startedAt) / ANIMATION_MS);
      // Ease-out cubic so the sweep settles gently.
      setProgress(1 - (1 - t) ** 3);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate]);
  return progress;
}

export interface RivalryDonutProps {
  slices: DonutSlice[];
  testID?: string;
  animate?: boolean;
}

export function RivalryDonut({ slices, testID, animate = true }: RivalryDonutProps) {
  const [width, setWidth] = useState(320);
  const progress = useSweepProgress(animate);
  const segments = donutSegments(
    slices.map((s) => s.value),
    { radius: RADIUS, padAngle: 3, progress },
  );
  const cx = width / 2;
  const cy = HEIGHT / 2;

  return (
    <View
      style={styles.container}
      testID={testID}
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.max(200, e.nativeEvent.layout.width))}
    >
      <Svg width={width} height={HEIGHT}>
        <G transform={`rotate(-90 ${cx} ${cy})`}>
          {segments.map((segment, i) => (
            <Circle
              key={slices[i]!.key}
              cx={cx}
              cy={cy}
              r={RADIUS}
              fill="none"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth={STROKE}
              strokeDasharray={`${segment.dashLength} ${segment.circumference}`}
              strokeDashoffset={segment.dashOffset}
            />
          ))}
        </G>
        <G>
          {segments.map((segment, i) => {
            const radians = ((segment.midAngle - 90) * Math.PI) / 180;
            const x = cx + LABEL_RADIUS * Math.cos(radians);
            const y = cy + LABEL_RADIUS * Math.sin(radians);
            return (
              <SvgText
                key={`${slices[i]!.key}-label`}
                x={x}
                y={y}
                fill={Colors.text}
                fontSize={12}
                fontFamily={LABEL_FONT}
                textAnchor={x < cx - 1 ? 'end' : x > cx + 1 ? 'start' : 'middle'}
                alignmentBaseline="middle"
              >
                {slices[i]!.label}
              </SvgText>
            );
          })}
        </G>
      </Svg>
      <View style={styles.legend}>
        {slices.map((slice, i) => (
          <View key={`${slice.key}-legend`} style={styles.legendItem}>
            <View
              style={[styles.swatch, { backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }]}
            />
            <Text style={styles.legendText}>{slice.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    paddingBottom: Spacing.sm,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  legendText: { ...Typography.caption, color: Colors.textSecondary },
});
