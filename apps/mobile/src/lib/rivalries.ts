import type { RivalryStats } from '@/api/types';

import { formatPoints } from './format';

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
}

/**
 * SHARKS are rivals who took points from the user (negative rivalry score); FISHES gave points
 * (positive). Each list is ordered by magnitude, biggest first.
 */
export function splitRivalries(rivalries: readonly RivalryStats[]): {
  sharks: RivalryStats[];
  fishes: RivalryStats[];
} {
  return {
    sharks: rivalries.filter((r) => r.score < 0).sort((a, b) => a.score - b.score),
    fishes: rivalries.filter((r) => r.score > 0).sort((a, b) => b.score - a.score),
  };
}

export function toDonutSlices(rivalries: readonly RivalryStats[]): DonutSlice[] {
  return rivalries.map((r) => ({
    key: r.id,
    label: `${r.rival.username}: ${formatPoints(r.score)}`,
    value: Math.abs(r.score),
  }));
}

export interface DonutSegment {
  /** Degrees clockwise from 12 o'clock. */
  start: number;
  sweep: number;
  midAngle: number;
  /** Stroke dash geometry for a `<circle>` of the given radius. */
  dashLength: number;
  dashOffset: number;
  circumference: number;
}

export interface DonutOptions {
  radius: number;
  /** Gap in degrees between adjacent slices (ignored for a single slice). */
  padAngle: number;
  /** 0..1 sweep animation progress. */
  progress: number;
}

export function donutSegments(
  values: readonly number[],
  { radius, padAngle, progress }: DonutOptions,
): DonutSegment[] {
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);
  if (total <= 0) return [];
  const circumference = 2 * Math.PI * radius;
  const toLength = (degrees: number) => (degrees * circumference) / 360;
  const pad = values.length > 1 ? padAngle : 0;
  let start = 0;
  return values.map((value) => {
    const sweep = (Math.max(0, value) / total) * 360 * progress;
    const segment: DonutSegment = {
      start,
      sweep,
      midAngle: start + sweep / 2,
      dashLength: toLength(Math.max(0, sweep - pad)),
      // Measured from the circle's stroke origin (3 o'clock); the chart rotates the circles a
      // quarter-turn back so 0° sits at 12 o'clock. A negative offset never wraps past the path
      // end, unlike shifting the origin through the offset itself.
      dashOffset: -toLength(start + Math.min(pad, sweep) / 2),
      circumference,
    };
    start += sweep;
    return segment;
  });
}
