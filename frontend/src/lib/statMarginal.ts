// The marginal plot's wire types and vertices (plan item 20): a scatter with the
// distribution of each axis along its top and right. The numbers come from
// `POST /api/statplots/marginal`; `marginalGeometry` only turns them into the
// vertices `calc/statplots_marginal.py` builds for the matplotlib export. Both
// are pinned to `tests/fixtures/wire/stat_marginal.json` and, for the opt-in
// encodings, `stat_dist2_options.json` (`Stage/statDist2Parity.test.ts`,
// `Stage/statDist2Options.test.ts`, `tests/test_stat_dist2*.py`).
//
// Strip coordinates: ALONG a strip the axis is data units; ACROSS it 0..1 from
// the edge touching the scatter outward. Lazy only (the Stat Stage).
//
// Opt-in encodings (see the module docstring of `calc/statplots_marginal.py`):
// a GROUP split (one distribution per group in each strip: shared histogram edges
// and peak, a box or rug in the group's slot of the cross axis), a COLOUR column
// (the screen's viridis gradient over the kept rows' range) and a SIZE column
// (`lib/sizescatter`'s linear diameter). Without them nothing below changes.

import { colormap, normalize } from "./colormap";
import { DEFAULT_SIZE_RANGE, sizeDiameter, type SizeKey } from "./sizescatter";

export type MarginalKind = "histogram" | "box" | "rug";

/** The strips' share of the plot area (each way) and the gap, as in the export. */
export const MARGINAL_RATIO = 0.2;
export const MARGINAL_GAP = 0.02;
export const MARGINAL_HIST_PEAK = 0.9;
export const MARGINAL_BOX_BAND: [number, number] = [0.25, 0.75];
const RUG_BAND = [0, 0.5] as const;
/** Group names the corner key lists before "+ n more". */
export const MARGINAL_KEY_GROUPS = 5;

export interface MarginalDistribution {
  edges?: number[];
  counts?: number[];
  q1?: number;
  median?: number;
  q3?: number;
  whislo?: number;
  whishi?: number;
  fliers?: number[];
}
/** The opt-in encodings the route takes, one value per (x, y) row. */
export interface MarginalEncodings {
  group?: number[];
  group_labels?: string[];
  color?: number[];
  color_label?: string;
  size?: number[];
  size_label?: string;
}
interface NumericColumn {
  z: number[];
  lo: number;
  hi: number;
  label: string;
}
export interface MarginalWire {
  kind: MarginalKind;
  n: number;
  x: number[];
  y: number[];
  domain: { x: [number, number]; y: [number, number] };
  marginals: { x: MarginalDistribution; y: MarginalDistribution; groups?: { x: MarginalDistribution[]; y: MarginalDistribution[] } };
  group?: number[];
  n_groups?: number;
  group_labels?: string[];
  color?: NumericColumn;
  size?: NumericColumn;
}
export type MarginalStrip =
  | { kind: "histogram"; bars: [number, number, number][] }
  | { kind: "box"; box: [number, number]; median: number; whiskers: [number, number]; fliers: number[]; band?: [number, number] }
  | { kind: "rug"; ticks: [number, number, number][] };
export interface MarginalKey {
  groups?: { ids: number[]; labels: string[]; more: number };
  color?: { label: string; lo: number; hi: number };
  size?: { label: string; lo: number; hi: number; marks: [number, number][] };
}
export interface MarginalGeometry {
  domain: MarginalWire["domain"];
  points: [number, number][];
  /** Ungrouped: one strip per axis. Grouped: `group_strips`, per axis a strip per group (null: no rows). */
  strips?: { x: MarginalStrip; y: MarginalStrip };
  group_strips?: { x: (MarginalStrip | null)[]; y: (MarginalStrip | null)[] };
  point_group?: number[];
  /** Per point: its hex fill (colour column) and diameter (size column; px on screen, pt in the export). */
  fills?: string[];
  diameters?: number[];
  key?: MarginalKey;
}

function strip(kind: MarginalKind, m: MarginalDistribution, values: number[], slot = 0, slots = 1, top?: number): MarginalStrip {
  if (kind === "histogram") {
    const counts = m.counts!;
    const peak = (top ?? Math.max(...counts)) || 1;
    return { kind, bars: counts.map((c, i): [number, number, number] => [m.edges![i], m.edges![i + 1], (MARGINAL_HIST_PEAK * c) / peak]) };
  }
  if (kind === "box") {
    const band: [number, number] | undefined =
      slots > 1 ? [(slot + MARGINAL_BOX_BAND[0]) / slots, (slot + MARGINAL_BOX_BAND[1]) / slots] : undefined;
    return { kind, box: [m.q1!, m.q3!], median: m.median!, whiskers: [m.whislo!, m.whishi!], fliers: m.fliers ?? [], ...(band ? { band } : {}) };
  }
  const [y0, y1] = slots > 1 ? [(slot + RUG_BAND[0]) / slots, (slot + RUG_BAND[1]) / slots] : RUG_BAND;
  return { kind, ticks: values.map((v): [number, number, number] => [v, y0, y1]) };
}

function groupStrips(r: MarginalWire, axis: "x" | "y"): (MarginalStrip | null)[] {
  const dists = r.marginals.groups![axis];
  const ids = r.group!;
  const n = r.n_groups!;
  const top = r.kind === "histogram" ? Math.max(0, ...dists.map((d) => (d.counts ? Math.max(...d.counts) : 0))) : undefined;
  return Array.from({ length: n }, (_, i) => {
    const mine = r[axis].filter((_, k) => ids[k] === i);
    return mine.length ? strip(r.kind, dists[i], mine, i, n, top) : null;
  });
}

const hex = (rgb: number[]) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
const sizeKeyOf = (s: NumericColumn): SizeKey => ({ channel: 0, label: s.label, lo: s.lo, hi: s.hi, minPx: DEFAULT_SIZE_RANGE[0], maxPx: DEFAULT_SIZE_RANGE[1] });

export function marginalGeometry(r: MarginalWire): MarginalGeometry {
  const geo: MarginalGeometry = {
    domain: r.domain,
    points: r.x.map((v, i): [number, number] => [v, r.y[i]]),
  };
  const key: MarginalKey = {};
  if (r.group && r.marginals.groups) {
    const present = [...new Set(r.group)].sort((a, b) => a - b);
    geo.point_group = r.group;
    geo.group_strips = { x: groupStrips(r, "x"), y: groupStrips(r, "y") };
    const shown = present.slice(0, MARGINAL_KEY_GROUPS);
    key.groups = { ids: shown, labels: shown.map((i) => r.group_labels![i]), more: Math.max(0, present.length - MARGINAL_KEY_GROUPS) };
  } else {
    geo.strips = { x: strip(r.kind, r.marginals.x, r.x), y: strip(r.kind, r.marginals.y, r.y) };
  }
  if (r.color) {
    const c = r.color;
    geo.fills = c.z.map((v) => hex(colormap("viridis", normalize(v, c.lo, c.hi, false) ?? 0)));
    key.color = { label: c.label, lo: c.lo, hi: c.hi };
  }
  if (r.size) {
    const s = r.size;
    const k = sizeKeyOf(s);
    geo.diameters = s.z.map((v) => sizeDiameter(k, v) ?? 0);
    const vals = s.hi > s.lo ? [s.lo, (s.lo + s.hi) / 2, s.hi] : [s.lo];
    key.size = { label: s.label, lo: s.lo, hi: s.hi, marks: vals.map((v): [number, number] => [v, sizeDiameter(k, v) as number]) };
  }
  if (Object.keys(key).length) geo.key = key;
  return geo;
}
