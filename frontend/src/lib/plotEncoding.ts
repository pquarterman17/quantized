// Graph Builder encodings: Color-by, Symbol-by and the legend-label source
// (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4, "Any suitable factor can drive Group,
// Facet, Legend, Color, Symbol, or X" and "Sample ID, field, or temperature can
// independently label the legend"). The spec carries them as three optional
// single-slot zones (`zones.color` / `.symbol` / `.label`, lib/plotspec.ts);
// this module turns them into series, per-series styles and legend entries.
//
// ONE DERIVATION, THREE CONSUMERS. `encodeSpec` below is the only place the
// encoded series are built. The Graph Builder preview canvas draws its
// `styles`, the preview legend lists its `legend` (built through the existing
// legend-entry builder, `multipanel.spatialCellStyling`, and rendered by the
// existing read-only `SpatialPanelLegend`), and the export request
// (`lib/plotEncodingExport.ts`) is assembled from the SAME result. The backend
// port is `calc/plotting_encoded.py`; the rules below are stated there too and
// pinned on both sides by the shared wire fixture
// `tests/fixtures/wire/graph_encoding_export.json`.
//
// THE SPLIT. The distinct factor columns among group, color and symbol (in that
// order, a repeated column counted once) partition the rows: one series per
// (Y channel, level combination) PRESENT in the data, channel-major, and the
// combinations in nested display order (outer factor first, each factor's levels
// through `categoryLevels`, so a user's level order holds). A row whose value in
// ANY factor is non-finite joins no series — the group split's own rule. With no
// factor at all (only a legend source) there is one series per channel. A flat
// Group-alone spec never reaches this module (it renders through `buildXY`);
// a FACETED one does, as a group-only split (`facetSplitEncoding`).
//
// THE ENCODING, through the existing cycles: a series is coloured
// `SERIES_VARS[k % 8]` with `k` its colour-factor LEVEL index (so one level has
// one colour across every Y channel), or its display position when there is no
// colour factor — `seriesColor`'s own rule. A symbol factor turns markers on
// with `AUTO_MARKER_CYCLE[k % 8]` by symbol LEVEL. The mark still decides the
// rest (`markSeriesStyle`: scatter = markers only, line/step keep their line).
//
// THE LEGEND SOURCE. A column (categorical factor or not: sample id, field,
// temperature) whose value(s) on a series' rows become its legend text: its
// levels there, formatted like a group level plus the column's unit, joined with
// ", ", or "first … last (n values)" past three. It replaces the name verbatim
// (BUG-014's rename rule, `seriesDisplayLabel`), prefixed "Y (…)" when more than
// one Y channel is plotted; rows with no finite value keep the default name.
//
// GATING, through the modeling chokepoint: symbol accepts only a channel
// `channelModelingType` reads as categorical (override first, then the P1.4
// level table, then inference — `isCategoricalChannel` is consulted there, the
// discipline Data Filter/Tabulate/Stat Stage already follow); a symbol pick
// that stops reading categorical is IGNORED at render time (the BUG-004
// lesson), and the well says so. Colour takes a categorical column as levels
// and a CONTINUOUS one as a GRADIENT (residual 4): no split; every point is
// coloured by its own row's value through `colorscatter.colorScatterFill`
// (viridis over the column's full finite range, `EncodedGradient`) and drawn
// as a point — the series' line hidden, MAIN #14's colour-mapped scatter rule
// — with its series' glyph; the legend gains one colour scale. The well names
// which reading applies.
//
// TEXT COLUMNS (residual 5): a row-indexed text column (Origin's
// `origin_text_columns`, no channel index) is picked by name and appended as a
// categorical channel by `plotEncodingBinding.encodingData` before the split,
// so it is a factor or a label source like any other column, and the wire
// dataset carries it to the backend.
//
// FACETS (residual 3): split ONCE over the whole data; each panel keeps the
// series with (kept) rows in it, over those rows (`encodedFacetPanels`), in one
// style everywhere (its level's colour, else its WHOLE-split position), legend
// text over the panel's rows, no gradient (`facetEncoding`). Greyed excluded
// rows add one muted companion per Y channel (`./facetEncodedExcluded`). The
// Stage (`Stage/useFacetEncoding`) and `calc/plotting_encoded_facets.py` share
// it (`graph_encoding_facets.json`, `facet_excluded.json`). Box/violin/bar: `./plotEncodingStat`.
//
// Applying the graph stores the picks on the plot window's document
// (`FigureBindings.encoding`, lib/plotEncodingBinding.ts); the editable Stage
// draws them through `encodedSplit` / `applyEncodedSplit` / `encodedNames` /
// `encodedStyle` below (Stage/usePlotEncoding.ts), the SAME functions
// `buildEncodedXY` and `encodedStyles` are made of, over its own fetched
// columns. The gate is `plotEncodingBinding.resolveFigureEncoding`, shared.
// Publication Preview puts the picks on its draft the same way.
//
// LAZY-ONLY on purpose: imported by the Graph Builder workshop and, through a
// dynamic import, by the Stage — never by lib/plotspec.ts, which sits in the
// eager graph (figureDocument.ts imports it).

import { categoryLevels, groupLevelLabel, levelOrderFor, levelsOf, orderLevels } from "./categorical";
import { buildErrorSpans, type ErrorSpan } from "./errorbars";
import type { ErrorBinding } from "./errorRoles";
import { ENCODING_SLOTS, type FigureEncodingText } from "./figureEncoding";
import { facetSlices, type FacetPanel, type FacetSlice } from "./facet";
import { seriesDisplayLabel } from "./seriesDisplayLabel";
import { spatialCellStyling } from "./multipanel";
import { buildColumns, type PlotPayload } from "./plotdata";
import { withChannelCompanions } from "./facetEncodedExcluded";
import {
  encodingSplits,
  facetSplitEncoding,
  isEncodingFactor,
  resolveFigureEncoding,
  type Encoding,
  type FigureEncoding,
} from "./plotEncodingBinding";
import {
  markSeriesStyle,
  specDatasetId,
  specErrorBindings,
  specToRender,
  type PlotSpec,
  type SpecRender,
} from "./plotspec";
import { statPlanRender } from "./plotEncodingStat";
import { specXKey } from "./plotspecGroupCol";
import { analysisData } from "./rowstate";
import { AUTO_MARKER_CYCLE, SERIES_VARS } from "./seriesStyleCycle";
import { encodedGradient, encodingData, type EncodedGradient } from "./plotEncodingScales";
import type { DataStruct, Dataset, SeriesStyle } from "./types";

/** Distinct label values listed in full before the "first … last (n values)"
 *  form — `calc.plotting_encoded.LABEL_LIST_MAX`. */
export const LABEL_LIST_MAX = 3;

export { isEncodingFactor, type Encoding };
// Residuals 4 and 5 (gradient scale, text-column factors) live in
// ./plotEncodingScales for this module's ceiling; re-exported so the Stage's one
// lazy import (`Stage/usePlotEncoding`) reaches them too.
export * from "./plotEncodingScales";

/** One encoded series, 1:1 with the payload's series. */
export interface EncodedSeries {
  channel: number;
  /** Colour / symbol factor LEVEL index, or null when that factor is unset. */
  colorLevel: number | null;
  symbolLevel: number | null;
  /** The label-source legend text (verbatim), or undefined for the default name. */
  legend: string | undefined;
}

export type EncodedLegendEntry = ReturnType<typeof spatialCellStyling>["legendEntries"][number];

/** Everything the preview and the export read, from one derivation. */
export interface EncodedSpec {
  ds: Dataset;
  /** The analysis rows (the wire dataset); `data` is them plus the appended
   *  text-column factors (`encodingData`), which the split reads. */
  source: DataStruct;
  data: DataStruct;
  enc: Encoding;
  /** Does a factor (group/color/symbol) split the series? False for a
   *  legend-source-only encoding, whose series stay 1:1 with the Y channels. */
  split: boolean;
  xKey: number | null;
  yChannels: number[];
  payload: PlotPayload;
  series: EncodedSeries[];
  styles: SeriesStyle[];
  legend: EncodedLegendEntry[];
  /** The Y/X error wells' bindings — kept only when nothing splits (a split
   *  series has no 1:1 well pairing, the group split's own rule), so the
   *  preview's whiskers and the export's `error_spans` come from one list. */
  errors: ErrorBinding[];
  /** The gradient Color-by's scale and per-row values (`data`'s rows), or null. */
  gradient: EncodedGradient | null;
  /** A faceted spec's panels (`encodedFacetPanels`); `series`/`styles` above
   *  are then the whole grid's split, which the panels draw from. */
  facets?: EncodedFacetPanel[];
}

/** One panel of an encoded xy FACET grid: the facet grid's own panel, plus
 *  each series' encoding, style and FINISHED legend text. */
export interface EncodedFacetPanel extends FacetPanel {
  series: EncodedSeries[];
  styles: SeriesStyle[];
  labels: string[];
}

/** The picks among `refs` (optionally only `datasetId`'s) as a document stores
 *  them: raw channel indices, a text column by name. Undefined when none. */
function picksOf(refs: PlotSpec["zones"], datasetId?: string): FigureEncoding | undefined {
  const picks: FigureEncoding = {};
  const text: FigureEncodingText = {};
  for (const k of ENCODING_SLOTS) {
    const r = refs[k];
    if (!r || (datasetId !== undefined && r.datasetId !== datasetId)) continue;
    if (r.text !== undefined) text[k] = r.text;
    else picks[k] = r.channel;
  }
  if (Object.keys(text).length > 0) picks.text = text;
  return Object.keys(picks).length > 0 ? picks : undefined;
}

/** The spec's encoding picks as the plot window's document stores them
 *  (`FigureBindings.encoding`) — raw channel indices and text-column names,
 *  ungated (the gate runs at render time) — or undefined when it sets none. */
export function specFigureEncoding(spec: PlotSpec): FigureEncoding | undefined {
  return picksOf(spec.zones);
}

/** The spec's encoding against `ds`, gated (see the module doc), or null when
 *  no colour / symbol / label / gradient survives — the ordinary render path. */
export function resolveEncoding(spec: PlotSpec, ds: Dataset): Encoding | null {
  return resolveFigureEncoding(picksOf(spec.zones, ds.id), ds, specGroupChannel(spec, ds));
}

/** The spec's Group channel on `ds`, or null when unset or on another dataset. */
function specGroupChannel(spec: PlotSpec, ds: Dataset): number | null {
  const group = spec.zones.group;
  return group?.datasetId === ds.id ? group.channel : null;
}

function channelLabel(data: DataStruct, channel: number): string {
  return data.labels[channel] ?? `col ${channel}`;
}

/** The legend text `labelCol` gives the series built from `rows`, or null when
 *  those rows carry no finite value (see the module doc). */
export function legendSourceText(data: DataStruct, labelCol: number, rows: readonly number[]): string | null {
  const present = orderLevels(levelsOf(rows.map((r) => data.values[r][labelCol])), levelOrderFor(data, labelCol));
  if (present.length === 0) return null;
  const unit = data.units[labelCol] ?? "";
  const texts = present.map((v) => {
    const t = groupLevelLabel(data, labelCol, v);
    return unit ? `${t} ${unit}` : t;
  });
  return texts.length <= LABEL_LIST_MAX
    ? texts.join(", ")
    : `${texts[0]} … ${texts[texts.length - 1]} (${texts.length} values)`;
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** One (Y channel, level combination) cell of the split, 1:1 with the series. */
interface SplitCell {
  /** Index into `EncodedSplit.yChannels` (so a payload column), not a channel. */
  y: number;
  /** The combination's rows, ascending — shared by every Y channel's cell. */
  rows: readonly number[];
  /** "factor=level, …" (empty with no factor) and the label-source text. */
  parts: string;
  text: string | null;
  colorLevel: number | null;
  symbolLevel: number | null;
}

/** The split's STRUCTURE — which rows each series draws and its levels — with
 *  no names yet (see `encodedNames`), so a caller that renames channels does
 *  not recompute it. */
export interface EncodedSplit {
  yChannels: readonly number[];
  cells: readonly SplitCell[];
}

/** Split `yChannels` by the encoding factors — the pure core
 *  `buildEncodedXY`, the Stage (`Stage/usePlotEncoding`) and
 *  `calc.plotting_encoded.build_encoded_series` share (see the module doc). */
export function encodedSplit(data: DataStruct, yChannels: readonly number[], enc: Encoding): EncodedSplit {
  const factors: number[] = [];
  for (const c of [enc.group, enc.color, enc.symbol]) if (c !== null && !factors.includes(c)) factors.push(c);
  const levels = factors.map((f) => categoryLevels(data, f));
  // value -> display index per factor. Levels are finite, so a NaN (or any
  // value no level holds) misses and the row joins no series.
  const index = levels.map((lv) => new Map(lv.map((v, i) => [v, i])));
  const byKey = new Map<string, { key: number[]; rows: number[] }>();
  data.values.forEach((row, r) => {
    const key: number[] = [];
    for (let k = 0; k < factors.length; k++) {
      const idx = index[k].get(row[factors[k]]);
      if (idx === undefined) return;
      key.push(idx);
    }
    const hit = byKey.get(key.join(","));
    if (hit) hit.rows.push(r);
    else byKey.set(key.join(","), { key, rows: [r] });
  });
  const combos = [...byKey.values()].sort((a, b) => compareKeys(a.key, b.key));
  const texts = combos.map((c) => (enc.label === null ? null : legendSourceText(data, enc.label, c.rows)));
  const parts = combos.map(({ key }) =>
    factors.map((f, k) => `${channelLabel(data, f)}=${groupLevelLabel(data, f, levels[k][key[k]])}`).join(", "),
  );
  const colorAt = enc.color === null ? -1 : factors.indexOf(enc.color);
  const symbolAt = enc.symbol === null ? -1 : factors.indexOf(enc.symbol);
  const cells: SplitCell[] = [];
  yChannels.forEach((_, y) =>
    combos.forEach(({ key, rows }, ci) =>
      cells.push({
        y,
        rows,
        parts: parts[ci],
        text: texts[ci],
        colorLevel: colorAt < 0 ? null : key[colorAt],
        symbolLevel: symbolAt < 0 ? null : key[symbolAt],
      }),
    ),
  );
  return { yChannels, cells };
}

/** Each split series' name and encoding. `yLegends` is BUG-014's per-Y-channel
 *  rename (aligned with `yChannels`): it replaces the channel label in both the
 *  default name and the multi-channel legend prefix, exactly as
 *  `calc.plotting_encoded.build_encoded_series`'s `y_legends` does. */
export function encodedNames(
  data: DataStruct,
  split: EncodedSplit,
  yLegends?: readonly (string | undefined)[],
): { specs: PlotPayload["series"]; series: EncodedSeries[] } {
  const { yChannels } = split;
  const specs: PlotPayload["series"] = [];
  const series: EncodedSeries[] = [];
  for (const cell of split.cells) {
    const yc = yChannels[cell.y];
    const yLabel = yLegends?.[cell.y] ?? channelLabel(data, yc);
    specs.push({ label: cell.parts ? `${yLabel} (${cell.parts})` : yLabel, unit: data.units[yc] ?? "", axis: 0 });
    series.push({
      channel: yc,
      colorLevel: cell.colorLevel,
      symbolLevel: cell.symbolLevel,
      legend: cell.text === null ? undefined : yChannels.length > 1 ? `${yLabel} (${cell.text})` : cell.text,
    });
  }
  return { specs, series };
}

/** Lay `split` over `base` — an x column plus one ROW-ALIGNED column per
 *  `split.yChannels` entry, in that order (`buildColumns`' own shape, and the
 *  Stage's never-decimated fetch) — keeping its x column and axis labels. */
export function applyEncodedSplit(
  base: PlotPayload,
  split: EncodedSplit,
  specs: PlotPayload["series"],
): PlotPayload {
  const [x, ...ys] = base.data as (number | null)[][];
  const cols: (number | null)[][] = [x];
  for (const cell of split.cells) {
    const src = ys[cell.y] ?? [];
    const col: (number | null)[] = new Array<number | null>(x.length).fill(null);
    for (const r of cell.rows) {
      const v = src[r];
      if (v !== null && v !== undefined && Number.isFinite(v)) col[r] = v;
    }
    cols.push(col);
  }
  return { ...base, data: cols as PlotPayload["data"], series: specs };
}

/** Split `yChannels` by the encoding factors into a drawable payload — the
 *  Graph Builder preview's and the export's form of the split. */
export function buildEncodedXY(
  data: DataStruct,
  xKey: number | null,
  yChannels: readonly number[],
  enc: Encoding,
  yLegends?: readonly (string | undefined)[],
): { payload: PlotPayload; series: EncodedSeries[] } {
  const split = encodedSplit(data, yChannels, enc);
  const { specs, series } = encodedNames(data, split, yLegends);
  // The x column and its axis label, exactly as every other xy payload builds them.
  return { payload: applyEncodedSplit(buildColumns(data, null, xKey, [...yChannels]), split, specs), series };
}

/** An encoded xy FACET grid (see the module doc): `data` is the split's
 *  source, each slice's `rows` index it, and each slice's `data` gives the
 *  panel's x and Y columns. `yLegends` is the per-Y rename, as `encodedNames`;
 *  `channelStyles` the per-channel styles (one in every panel) the encoding is laid
 *  over (`encodedStyle`, FEATURE-001); `dropped` greys FULL level slices (F4.2c (a)). */
export function encodedFacetPanels(
  data: DataStruct,
  slices: readonly Pick<FacetSlice, "label" | "data" | "rows">[],
  xKey: number | null,
  yChannels: readonly number[],
  enc: Encoding,
  yLegends?: readonly (string | undefined)[],
  channelStyles?: Record<number, SeriesStyle>,
  dropped?: ReadonlySet<number>,
): EncodedFacetPanel[] {
  const whole = encodedSplit(data, yChannels, enc);
  const styles = encodedNames(data, whole).series.map((s, i) => encodedStyle(channelStyles?.[s.channel], s, i));
  return slices.map((slice) => {
    const local = new Map(slice.rows.map((r, j) => [r, j]));
    const keep: number[] = [];
    const cells = whole.cells.flatMap((c, i) => {
      const mine = c.rows.filter((r) => local.has(r) && !dropped?.has(r));
      if (mine.length === 0) return [];
      keep.push(i);
      const text = enc.label === null ? null : legendSourceText(data, enc.label, mine);
      return [{ ...c, rows: mine.map((r) => local.get(r) as number), text }];
    });
    const split: EncodedSplit = { yChannels, cells };
    const { specs, series } = encodedNames(data, split, yLegends);
    const base = buildColumns(slice.data, null, xKey, [...yChannels]);
    return {
      label: slice.label,
      payload: withChannelCompanions(applyEncodedSplit(base, split, specs), base, slice.rows, dropped),
      channels: series.map((s) => s.channel),
      series,
      styles: keep.map((i) => styles[i]),
      labels: specs.map((sp, i) => seriesDisplayLabel(sp.label, sp.unit, series[i].legend)),
    };
  });
}

/** One encoded series' EFFECTIVE style over `base`: the level's palette token
 *  when a colour factor is set (overriding any base colour), else the base
 *  colour, else the series' display-position token — `seriesColor`'s own rule,
 *  and `calc.plotting_encoded.encoded_series_styles`' — and, for a symbol
 *  factor, markers on with the level's glyph. */
export function encodedStyle(base: SeriesStyle | undefined, s: EncodedSeries, i: number): SeriesStyle {
  const n = SERIES_VARS.length;
  return {
    ...base,
    color: s.colorLevel !== null ? SERIES_VARS[s.colorLevel % n] : (base?.color ?? SERIES_VARS[i % n]),
    ...(s.symbolLevel !== null
      ? { marker: true, markerShape: AUTO_MARKER_CYCLE[s.symbolLevel % AUTO_MARKER_CYCLE.length] }
      : {}),
  };
}

/** The Graph Builder's styles: `encodedStyle` over the mark's own translation
 *  (`markSeriesStyle`), which sets no colour. */
export function encodedStyles(spec: PlotSpec, series: readonly EncodedSeries[]): SeriesStyle[] {
  const base = markSeriesStyle(spec);
  return series.map((s, i) => encodedStyle(base, s, i));
}

/** THE derivation (see the module doc), or null when the spec renders through
 *  the ordinary path: not an xy mark, no dataset/rows/Y, or no surviving
 *  encoding (a faceted spec's gradient does not survive; its Group alone does). */
export function encodeSpec(spec: PlotSpec, datasets: readonly Dataset[]): EncodedSpec | null {
  if (spec.mark !== "scatter" && spec.mark !== "line" && spec.mark !== "step") return null;
  if (spec.zones.y.length === 0) return null;
  const ds = datasets.find((d) => d.id === specDatasetId(spec));
  const rows = analysisData(ds);
  if (!ds || !rows || rows.time.length === 0) return null;
  const facetCol = spec.zones.facet?.channel ?? null;
  const own = resolveEncoding(spec, ds); // a facet grid splits by Group alone too, as the Stage does
  const enc = facetCol === null ? own : facetSplitEncoding(own, specGroupChannel(spec, ds));
  if (!enc) return null;
  const data = encodingData(rows, enc); // text-column factors appended (residual 5)
  const xKey = specXKey(spec); // own X (a negative channel) = an empty well
  const yChannels = spec.zones.y.map((r) => r.channel);
  const { payload, series } = buildEncodedXY(data, xKey, yChannels, enc);
  const styles = encodedStyles(spec, series);
  const split = encodingSplits(enc);
  // Facets: the grid's key lists each distinct (label, colour, glyph) once, in
  // panel order — a series' legend text may differ between panels.
  const facets = facetCol === null ? undefined : encodedFacetPanels(data, facetSlices(data, facetCol), xKey, yChannels, enc);
  const flat = series.map((s, i) => ({
    label: seriesDisplayLabel(payload.series[i].label, payload.series[i].unit, s.legend),
    style: styles[i],
  }));
  const keyed = facets?.flatMap((p) => p.labels.map((label, i) => ({ label, style: p.styles[i] })));
  const same = (a: (typeof flat)[number], b: (typeof flat)[number]) =>
    a.label === b.label && a.style.color === b.style.color && a.style.markerShape === b.style.markerShape;
  const entries = keyed ? keyed.filter((e, i) => keyed.findIndex((o) => same(o, e)) === i) : flat;
  // The existing legend-entry builder, keyed by DISPLAY POSITION: each encoded
  // series is its own "channel" here, so the entry carries exactly the style
  // the preview canvas draws it with (no cycle — the encoding already chose).
  const { legendEntries } = spatialCellStyling(
    {
      yKeys: entries.map((_, i) => i),
      hiddenChannels: [],
      seriesStyles: Object.fromEntries(entries.map((e, i) => [i, e.style])),
      seriesLabels: Object.fromEntries(entries.map((e, i) => [i, e.label])),
    },
    false,
  );
  const errors = split || facets ? [] : specErrorBindings(spec);
  const gradient = encodedGradient(data, enc);
  return {
    ds, source: rows, data, enc, split, xKey, yChannels, payload, series, styles, legend: legendEntries, errors, gradient,
    ...(facets ? { facets } : {}),
  };
}

/** The Graph Builder render: `specToRender` for every spec that does not
 *  encode, else the same xy render built from the encoded payload (so the
 *  split is computed once, not once by `buildXY` and again here). Error
 *  whiskers follow `EncodedSpec.errors`: kept for a legend-source-only
 *  encoding, dropped — like a grouped render — once a factor splits. */
export function encodedSpecRender(
  spec: PlotSpec,
  datasets: readonly Dataset[],
): { render: SpecRender; encoded: EncodedSpec | null } {
  const encoded = encodeSpec(spec, datasets);
  // Box / violin: a Color pick may nest the axis (lib/plotEncodingStat).
  if (!encoded) return { render: statPlanRender(spec, datasets) ?? specToRender(spec, datasets), encoded: null };
  const spans: Map<number, ErrorSpan[]> =
    encoded.errors.length > 0 ? buildErrorSpans(encoded.data, encoded.yChannels, encoded.errors) : new Map();
  return {
    render: {
      kind: "xy",
      payload: encoded.payload,
      mark: spec.mark as "scatter" | "line" | "step",
      grouped: encoded.split,
      ...(spec.showMarkers ? { showMarkers: true } : {}),
      ...(spec.mark === "step" ? { stepMode: spec.stepMode ?? "post" } : {}),
      ...(spans.size > 0 ? { errorSpans: spans } : {}),
      ...(encoded.facets ? { facets: encoded.facets } : {}),
    },
    encoded,
  };
}
