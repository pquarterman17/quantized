// The lazy half of the colour gradient across N curves (see `seriesRamp.ts`):
// the gate, the colormap stops and the resolver that turns a graph's ramp into
// literal per-channel colours. The canvas reaches it through the marks chunk
// (`marksImpl`); the export spec builder (itself lazy) imports it.

import { firstNumber } from "./firstNumber";
import { effectiveChannels } from "./plotdata";
import type { FigureDocument } from "./figureDocument";
import { rampLive, type RampMap, type SeriesRamp } from "./seriesRamp";
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

/** The OKLab lightness window every ramp colour is compressed into, so it
 *  clears the canvas' contrast floor (`contrastColor.MIN_CONTRAST`, 2.2) on
 *  BOTH plot backgrounds: relative luminance about 0.08 to 0.38, against the
 *  dark canvas (0.006) and the light one (0.94). A colour inside it is never
 *  swapped for the ink token on screen, so both themes and the export draw the
 *  same hex. The map's OWN lightness range is mapped linearly onto this window
 *  (review M1: a per-sample clamp flattened both ends), so the perceptual
 *  order and the hue of every stop are kept, and adjacent curves stay apart
 *  (`seriesRamp.test.ts` pins ΔE >= 3 for up to 12 curves on every map). */
const OK_LO = 0.445;
const OK_HI = 0.71;

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (l: number) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);

/** sRGB bytes -> OKLab [L, a, b] (Björn Ottosson's published matrices). */
export function toOklab(rgb: readonly number[]): number[] {
  const [r, g, b] = rgb.map((c) => toLin(c / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab -> LINEAR sRGB (may fall outside [0, 1]: out of gamut). */
function fromOklab(L: number, a: number, b: number): number[] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const okRange = new Map<RampMap, [number, number]>();

/** The map's colour at `t`, its OKLab lightness compressed from the map's own
 *  range onto [OK_LO, OK_HI] with hue and chroma kept; chroma is reduced only
 *  as far as the sRGB gamut requires. */
export function legibleRgb(map: RampMap, rgb: readonly number[]): number[] {
  let range = okRange.get(map);
  if (!range) {
    const ls = Array.from({ length: STOPS[map].length / 6 }, (_, k) => toOklab(sampleRamp(map, k / (STOPS[map].length / 6 - 1)))[0]);
    range = [Math.min(...ls), Math.max(...ls)];
    okRange.set(map, range);
  }
  const [L, a, b] = toOklab(rgb);
  const Lt = OK_LO + ((L - range[0]) / (range[1] - range[0])) * (OK_HI - OK_LO);
  let out = fromOklab(Lt, a, b);
  for (let k = 0.95; k > 0.01 && out.some((c) => c < 0 || c > 1); k *= 0.95) out = fromOklab(Lt, a * k, b * k);
  return out.map((c) => Math.round(Math.min(1, Math.max(0, toSrgb(Math.min(1, Math.max(0, c))))) * 255));
}

/** The map's colour at `t` in [0, 1], before the lightness compression. */
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
  return `#${legibleRgb(ramp.map, sampleRamp(ramp.map, ramp.reverse ? 1 - t : t)).map(hex2).join("")}`;
}

/** Each curve's rank when ordered by the first number in its label, or null
 *  unless EVERY label has one and no two are equal (review L11: a tie makes the
 *  order unreliable, so the plotted order is used instead). */
export function valueRanks(labels: readonly string[]): number[] | null {
  const vals = labels.map((l) => firstNumber(l) ?? NaN);
  if (vals.some((v) => !Number.isFinite(v)) || new Set(vals).size < vals.length) return null;
  const order = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
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
    // Every curve carries its rank (an own colour keeps its slot), so a greyscale print keeps the order.
    out[ch] = { ...styles[ch], rampRank: ranks[i], ...(styles[ch]?.color ? {} : { color: rampColor(ramp, ranks[i], list.length) }) };
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
  if (!rampLive(view.seriesRamp) || !rampApplies(view, extras.publicationSeriesStyles !== undefined, !!extras.encoding)) return view;
  const channels = effectiveChannels(data, view.yKeys, view.xKey, roles, view.seriesOrder);
  const label = (ch: number) => view.seriesLabels[ch] ?? data.labels[ch] ?? "";
  return { ...view, seriesStyles: rampSeriesStyles(view.seriesStyles, channels, view.seriesRamp!, label) };
}
