// Marker SIZE driven by a column (gap audit 3, N5): a plotted series' points
// are drawn with a diameter taken from a THIRD channel, mapped linearly over
// that channel's full finite range onto [minPx, maxPx]. The pure core; the
// canvas drawing is `uplotOverlays.colorScatterPlugin` (per-point radius), the
// export is `calc/figure_sizes.py` (the same linear map, squared for matplotlib's
// `s`) — one rule on both sides: `sizeDiameter`.

import { withUnit } from "./unitDisplay";
import type { DataStruct } from "./types";

/** Marker diameter range (px on the canvas, points in the export) — the
 *  backend's `figure_sizes.DEFAULT_SIZE_RANGE`. */
export const DEFAULT_SIZE_RANGE: [number, number] = [3, 14];

export interface SizeKey {
  /** The size channel's index (legend title). */
  channel: number;
  /** The channel's full finite range (stable across zoom/pan). */
  lo: number;
  hi: number;
  minPx: number;
  maxPx: number;
}

/** A usable `[min, max]` px range (0 < min <= max), else the default. */
export function sizeRange(r: readonly number[] | undefined): [number, number] {
  return r && r.length === 2 && r[0] > 0 && r[0] <= r[1] && Number.isFinite(r[1])
    ? [r[0], r[1]]
    : [...DEFAULT_SIZE_RANGE];
}

/** The size key of `channel` over every row, or null when it has no finite value. */
export function buildSizeKey(ds: DataStruct, channel: number, range?: readonly number[]): SizeKey | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of ds.values) {
    const v = row[channel];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo > hi) return null;
  const [minPx, maxPx] = sizeRange(range);
  return { channel, lo, hi, minPx, maxPx };
}

/** One row's marker diameter, or null for a non-finite value (no point). A
 *  constant column reads mid-range. Port: `figure_sizes.size_diameters`. */
export function sizeDiameter(key: SizeKey, v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const t = key.hi > key.lo ? (v - key.lo) / (key.hi - key.lo) : 0.5;
  return key.minPx + t * (key.maxPx - key.minPx);
}

export interface SizeLegendEntry {
  label: string;
  marks: { value: number; px: number }[];
}

/** The size key chips: the channel's label and its min / middle / max sizes. */
export function sizeLegendEntries(ds: DataStruct, specs: readonly { size?: SizeKey }[]): SizeLegendEntry[] {
  const seen = new Set<string>();
  const out: SizeLegendEntry[] = [];
  for (const { size: k } of specs) {
    if (!k) continue;
    const label = withUnit(ds.labels[k.channel] ?? `channel ${k.channel}`, ds.units[k.channel]);
    const marks = k.hi > k.lo
      ? [k.lo, (k.lo + k.hi) / 2, k.hi].map((value) => ({ value, px: sizeDiameter(k, value) as number }))
      : [{ value: k.lo, px: sizeDiameter(k, k.lo) as number }];
    const key = JSON.stringify([label, marks]);
    if (!seen.has(key)) { seen.add(key); out.push({ label, marks }); }
  }
  return out;
}
