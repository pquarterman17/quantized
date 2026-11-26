// The "Avoid overlaps" option of point labels (plan item 18): present = on, absent
// = off (today's placement). The placement itself is lib/labelPlacement.ts (lazy);
// this is only the eager setting and its sanitizer.

export interface LabelAvoid {
  /** A label farther than this many label heights from its point gets a leader line. */
  leaderDistance: number;
  /** Leader line width (px on screen, pt in the export). */
  leaderWidth: number;
  leaderDashed: boolean;
}

export const DEFAULT_LABEL_AVOID: LabelAvoid = { leaderDistance: 1.5, leaderWidth: 0.75, leaderDashed: false };
export const LEADER_DISTANCE_RANGE = [0.5, 8] as const;
export const LEADER_WIDTH_RANGE = [0.25, 3] as const;

const num = (v: unknown, [lo, hi]: readonly [number, number], dflt: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : dflt;

/** A stored value -> a valid option, or undefined (off). Fails closed per field. */
export function sanitizeLabelAvoid(raw: unknown): LabelAvoid | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const d = DEFAULT_LABEL_AVOID;
  return {
    leaderDistance: num(o.leaderDistance, LEADER_DISTANCE_RANGE, d.leaderDistance),
    leaderWidth: num(o.leaderWidth, LEADER_WIDTH_RANGE, d.leaderWidth),
    leaderDashed: o.leaderDashed === true,
  };
}
