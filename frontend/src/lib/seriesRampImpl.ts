// The lazy half of the colour gradient across N curves (see `seriesRamp.ts`):
// the gate, the colormap stops and the resolver that turns a graph's ramp into
// literal per-channel colours. The canvas reaches it through the marks chunk
// (`marksImpl`); the export spec builder (itself lazy) imports it.

import { effectiveChannels } from "./plotdata";
import type { FigureDocument } from "./figureDocument";
import type { RampMap, SeriesRamp } from "./seriesRamp";
import { documentPinsSeriesStyles, overlayModesMatchTheCanvas, type CycleView } from "./seriesStyleCycle";
import type { SeriesStyle } from "./seriesStyleTypes";
import type { Dataset, DataStruct } from "./types";

/** Eleven evenly spaced stops per map, sampled from matplotlib's own tables
 *  (`matplotlib.colormaps[name](i / 10)`), as 6-hex-digit runs. Linear
 *  interpolation between them is what both renderers draw: the export is sent
 *  the resolved hex, never the map name. */
const STOPS: Record<RampMap, string> = {
  viridis: "440154482475414487355f8d2a788e21918c22a88444bf707ad151bddf26fde725",
  plasma: "0d088741049d6a00a88f0da4b12a90cc4778e16462f2844bfca636fcce25f0f921",
  magma: "000004140e363b0f70641a808c2981b73779de4968f7705cfe9f6dfecf92fcfdbf",
  cividis: "00224e08337035456c4f576c6669707d7c78948e77aea371c8b866e5cf52fee838",
  coolwarm: "3b4cc05977e37b9ff99ebeffc0d4f5dddcdcf2cbb7f7ac8eee8468d65244b40426",
  turbo: "30123b4559cb3e9bfe19d5cd46f884a4fc3ce1dd37fea431f05b12c325037a0403",
};

/** Relative-luminance window every ramp colour is pulled into, so it clears the
 *  canvas' contrast floor (`contrastColor.MIN_CONTRAST`, 2.2) on BOTH plot
 *  backgrounds: >= 0.08 reads on the dark canvas (L 0.006), <= 0.32 on the
 *  light one (L 0.94). A colour inside it is never swapped for the ink token
 *  on screen, so the dark theme, the light theme and the export all draw the
 *  same hex. Viridis' near-black purple is lifted and its yellow end deepened;
 *  mid-tones are untouched. */
const L_MIN = 0.08;
const L_MAX = 0.32;

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (l: number) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);

const lumOf = (lin: readonly number[]) => 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];

/** `rgb` (0..255 bytes) with its luminance clamped into [L_MIN, L_MAX], exact
 *  in luminance and keeping the hue: the linear channels are scaled (which
 *  keeps the chromaticity), and only a colour too dark to scale far enough
 *  without clipping a channel is then mixed toward white for the rest. */
export function legibleRgb(rgb: readonly number[]): number[] {
  const lin = rgb.map((c) => toLin(c / 255));
  const lum = lumOf(lin);
  let out = lin;
  if (lum > L_MAX) out = lin.map((c) => (c * L_MAX) / lum);
  else if (lum < L_MIN) {
    const peak = Math.max(...lin);
    const k = lum > 0 ? Math.min(L_MIN / lum, 1 / peak) : 0;
    out = lin.map((c) => c * k);
    const l2 = lumOf(out);
    const a = (L_MIN - l2) / (1 - l2);
    out = out.map((c) => c + (1 - c) * a);
  }
  return out.map((c) => Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255));
}

/** The map's colour at `t` in [0, 1], before the legibility clamp. */
export function sampleRamp(map: RampMap, t: number): number[] {
  const hex = STOPS[map];
  const n = hex.length / 6 - 1;
  const pos = Math.min(1, Math.max(0, t)) * n;
  const i = Math.min(n - 1, Math.floor(pos));
  const f = pos - i;
  const at = (k: number, c: number) => parseInt(hex.slice(k * 6 + c * 2, k * 6 + c * 2 + 2), 16);
  return [0, 1, 2].map((c) => at(i, c) + (at(i + 1, c) - at(i, c)) * f);
}

const hex2 = (v: number) => v.toString(16).padStart(2, "0");

/** The ramp's colour for rank `k` of `n` curves, as `#rrggbb`. One curve takes
 *  the map's start (its end when reversed). */
export function rampColor(ramp: SeriesRamp, k: number, n: number): string {
  const t = n > 1 ? k / (n - 1) : 0;
  return `#${legibleRgb(sampleRamp(ramp.map, ramp.reverse ? 1 - t : t)).map(hex2).join("")}`;
}

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i;

/** Each curve's rank when ordered by the first number in its label, or null
 *  when any label has none or every number is the same (the order would say
 *  nothing). Ties keep their plotted order. */
export function valueRanks(labels: readonly string[]): number[] | null {
  const vals = labels.map((l) => {
    const m = NUMBER.exec(l);
    return m ? Number(m[0]) : NaN;
  });
  if (vals.some((v) => !Number.isFinite(v)) || vals.every((v) => v === vals[0])) return null;
  const order = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const ranks = new Array<number>(vals.length);
  order.forEach(([, i], r) => (ranks[i] = r));
  return ranks;
}

/** `styles` with every curve of the plotted list `channels` that has no
 *  explicit colour given its ramp colour. `label(ch)` is the curve's legend
 *  text (for `order: "value"`). A channel listed twice keeps its first slot. */
export function rampSeriesStyles(
  styles: Record<number, SeriesStyle>,
  channels: readonly number[],
  ramp: SeriesRamp,
  label: (ch: number) => string,
): Record<number, SeriesStyle> {
  const list = [...new Set(channels)];
  const ranks = (ramp.order === "value" && valueRanks(list.map(label))) || list.map((_, i) => i);
  const out = { ...styles };
  list.forEach((ch, i) => {
    if (!styles[ch]?.color) out[ch] = { ...styles[ch], color: rampColor(ramp, ranks[i], list.length) };
  });
  return out;
}

/** Does a window drawing `view` colour its curves by its ramp? ONE predicate
 *  for the canvas (`rampedStyles` below) and the export (`rampView`).
 *  `pinned`: the document pins publication styles; `encoded`: it has Color /
 *  Symbol / Label encodings. */
export function rampApplies(view: CycleView & { seriesRamp?: SeriesRamp | null }, pinned: boolean, encoded: boolean): boolean {
  return !!view.seriesRamp && !pinned && !encoded && overlayModesMatchTheCanvas(view);
}

/** `rampApplies` for a window with `doc` behind it. */
export const windowRampApplies = (
  view: CycleView & { seriesRamp?: SeriesRamp | null },
  doc: { publication?: { seriesStyles?: readonly unknown[] | null }; bindings?: { encoding?: object } } | null | undefined,
): boolean => rampApplies(view, documentPinsSeriesStyles(doc), !!doc?.bindings?.encoding);

/** The view fields the ramp reads. */
export type RampView = CycleView & {
  seriesRamp?: SeriesRamp | null;
  seriesStyles: Record<number, SeriesStyle>;
  seriesLabels: Record<number, string>;
  seriesOrder: number[] | null;
  yKeys: number[] | null;
};

/** Per style map, the last few results (two windows may share one map). */
const memo = new WeakMap<object, { deps: unknown[]; out: Record<number, SeriesStyle> }[]>();

/** The canvas' half (`Stage/useSeriesRamp`): `view.seriesStyles` with the
 *  window's ramp applied over `effectiveChannels` (the list `usePlotPayload`
 *  and `figureSpecSeries.resolveDisplaySeries` both use), or the same
 *  reference when it has none or refuses it. Memoized on every input, so a
 *  store selector can return it and a re-render gets the same object back. */
export function rampedStyles(view: RampView, ds: Dataset | null | undefined, doc: FigureDocument | undefined): Record<number, SeriesStyle> {
  const ramp = view.seriesRamp;
  if (!ramp || !ds || !windowRampApplies(view, doc)) return view.seriesStyles;
  const deps = [ramp, view.seriesLabels, view.xKey, view.yKeys, view.seriesOrder, ds.data, ds.channelRoles];
  const seen = memo.get(view.seriesStyles) ?? [];
  const hit = seen.find((e) => e.deps.every((d, i) => d === deps[i]));
  if (hit) return hit.out;
  const channels = effectiveChannels(ds.data, view.yKeys, view.xKey, ds.channelRoles, view.seriesOrder);
  const out = rampSeriesStyles(view.seriesStyles, channels, ramp, (ch) => view.seriesLabels[ch] ?? ds.data.labels[ch] ?? "");
  memo.set(view.seriesStyles, [{ deps, out }, ...seen.slice(0, 3)]);
  return out;
}

/** The export's half (`figureSpec.buildFigureSpecForView`): `view` with its
 *  ramp resolved onto its channel styles, on the SOURCE channels, before any
 *  per-series-X re-cut, exactly what `Stage/useSeriesRamp` hands the canvas.
 *  `extras` says whether the document pins its styles or encodes colour. */
export function rampView<V extends CycleView & {
  seriesRamp?: SeriesRamp | null;
  seriesStyles: Record<number, SeriesStyle>;
  seriesLabels: Record<number, string>;
  seriesOrder: number[] | null;
  yKeys: number[] | null;
}>(
  view: V,
  data: DataStruct,
  roles: Dataset["channelRoles"] | undefined,
  extras: { publicationSeriesStyles?: unknown; encoding?: unknown },
): V {
  if (!view.seriesRamp || !rampApplies(view, extras.publicationSeriesStyles !== undefined, !!extras.encoding)) return view;
  const channels = effectiveChannels(data, view.yKeys, view.xKey, roles, view.seriesOrder);
  const label = (ch: number) => view.seriesLabels[ch] ?? data.labels[ch] ?? "";
  return { ...view, seriesStyles: rampSeriesStyles(view.seriesStyles, channels, view.seriesRamp, label) };
}
