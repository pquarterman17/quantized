// P1.4 (PRIMARY_SOFTWARE_AUDIT_PLAN, "Any suitable factor can drive Group,
// Facet, Legend, Color, Symbol, or X"): the editable Stage's Color-by /
// Symbol-by / legend-label source. The picks ride the plot window's document
// (`FigureBindings.encoding`, set by the Graph Builder's apply); this hook turns
// them into what `usePlotPayload` draws, through the SAME functions the Graph
// Builder preview and its export are built from (`lib/plotEncoding`'s
// `encodedSplit` / `encodedNames` / `applyEncodedSplit` / `encodedStyle`) — no
// second derivation. The gate (which picks survive, and the secondary-axis
// degrade) is `plotEncodingBinding.windowEncoding`, which the document export
// (`figureSpec.buildFigureSpecForView`) calls too, so screen and PDF agree on
// whether a window is encoded at all.
//
// It REPLACES the P1.5 group split when active (the group factor joins the
// encoded split, as in the preview), over the Stage's own never-decimated
// fetch: the split masks each fetched column by row, so the x column, the
// categorical-x remap and the log-scale nulls are the Stage's own.
//
// Identity follows P1.5's edit-one/edit-all ruling (lib/plotGroupSplit.ts's
// header): every encoded series of one Y channel maps back to that channel in
// `plotted`, so restyle / hide / rename act on the whole channel. The colour
// and glyph come from the encoding on top of that channel's style
// (`encodedStyle`), and a rename replaces the channel's name inside every
// series name (BUG-014's `y_legends`, as the export applies it).
//
// LAZY: `lib/plotEncoding` loads through a dynamic import the first time a
// window carries an encoding (the eager bundle pays only this hook and the
// gate). Until it resolves, the window draws unencoded — one frame on a cold
// load; the fetch then re-runs because `plotted` changes.

import { useEffect, useMemo, useState } from "react";

import type { ColorScatterSpec } from "../../lib/colorscatter";
import { seriesDisplayLabel } from "../../lib/seriesDisplayLabel";
import type { PlotPayload } from "../../lib/plotdata";
import { encodingSplits, windowEncoding, type FigureEncoding } from "../../lib/plotEncodingBinding";
import { rowStateIdentity } from "../../lib/rowstate";
import type { Dataset, SeriesStyle } from "../../lib/types";
import { useStableByValue } from "../../lib/useStableValue";

type EncodingModule = typeof import("../../lib/plotEncoding");
let loaded: EncodingModule | null = null;
let loading: Promise<EncodingModule> | null = null;
function loadEncodingModule(): Promise<EncodingModule> {
  loading ??= import("../../lib/plotEncoding").then((m) => (loaded = m));
  return loading;
}

/** The lazy derivation module once `wanted` has asked for it (null until it
 *  resolves) — shared by this hook and the facet grid's (`useFacetEncoding`). */
export function useEncodingModule(wanted: boolean): EncodingModule | null {
  const [mod, setMod] = useState<EncodingModule | null>(loaded);
  useEffect(() => {
    if (!wanted || mod) return;
    let live = true;
    void loadEncodingModule().then((m) => {
      if (live) setMod(m);
    });
    return () => {
      live = false;
    };
  }, [wanted, mod]);
  return mod;
}

/** What an encoded Stage render needs from the derivation. */
export interface StageEncoding {
  /** Does a factor split the series? False for a legend-source-only encoding,
   *  whose series stay 1:1 with the Y channels (so error bars still apply). */
  split: boolean;
  /** The Y channel of each encoded series, in draw order (edit-all identity). */
  plotted: number[];
  /** Lay the split over the Stage's fetched payload (x + one column per
   *  fetched channel). Name-independent, so a rename does not re-fetch. */
  apply: (payload: PlotPayload) => PlotPayload;
  /** Per-series styles over the channels' own styles. */
  styles: (seriesStyles: Record<number, SeriesStyle>) => SeriesStyle[];
  /** Per-series FINISHED legend text, the channel renames applied. */
  labels: (seriesLabels: Record<number, string>) => string[];
  /** A gradient Color-by's colour-mapped points (residual 4), keyed like
   *  `colorscatter.buildColorByColumns`, or null without one. */
  colorBy: ((styles: readonly SeriesStyle[]) => Map<number, ColorScatterSpec>) | null;
}

/** The Stage's encoding for `active`, or null when the window renders through
 *  the ordinary (or P1.5 group) path — no picks, none surviving the gate, a
 *  bound secondary axis, or the derivation not loaded yet. */
export function useStageEncoding(
  active: Dataset | null | undefined,
  picks: FigureEncoding | undefined,
  groupCol: number | null,
  y2Keys: readonly number[] | null,
  channels: readonly number[],
): StageEncoding | null {
  // A window's document is rebuilt on every facade commit, so the picks arrive
  // as a fresh object each time — keyed by value, or every commit re-fetches.
  const stablePicks = useStableByValue(picks, (v) => JSON.stringify(v));
  // Keyed on the fields the derivation reads (the gate: data, channelTypes,
  // pending; the gradient's analysis view: excludedRows, filter), never on
  // `active` itself: a rename mints a new `active` over the same data and
  // must not rebuild the encoding, or `plotted` changes and the plot refetches.
  const [excludedId, filterId, dataId] = rowStateIdentity(active);
  const source = useMemo(
    () => active ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active?.id, dataId, active?.channelTypes, active?.pending, excludedId, filterId],
  );
  const enc = useMemo(
    () => (source ? windowEncoding(stablePicks, source, groupCol, y2Keys) : null),
    [source, stablePicks, groupCol, y2Keys],
  );
  const mod = useEncodingModule(enc !== null);

  return useMemo(() => {
    if (!enc || !mod || !source) return null;
    const data = mod.encodingData(source.data, enc); // residual 5: text-column factors appended
    const split = mod.encodedSplit(data, channels, enc);
    const { specs, series } = mod.encodedNames(data, split);
    const gradient = mod.stageGradient(source, data, enc); // residual 4: scale over the kept rows

    return {
      split: encodingSplits(enc),
      plotted: series.map((s) => s.channel),
      apply: (payload) => mod.applyEncodedSplit(payload, split, specs),
      styles: (seriesStyles) => series.map((s, i) => mod.encodedStyle(seriesStyles[s.channel], s, i)),
      labels: (seriesLabels) => {
        const named = mod.encodedNames(data, split, channels.map((c) => seriesLabels[c]));
        return named.specs.map((sp, i) => seriesDisplayLabel(sp.label, sp.unit, named.series[i].legend));
      },
      colorBy: gradient ? (styles) => mod.gradientColumns(gradient, styles) : null,
    };
  }, [enc, mod, source, channels]);
}

/** `usePlotPayload`'s per-display-series style and label lists for an encoded
 *  render (encoded series first, overlays after — undefined, i.e. defaults),
 *  or null when `encoded` is null and the ordinary lists apply. */
export function useEncodedLists(
  encoded: StageEncoding | null,
  displayPayload: PlotPayload | null,
  seriesStyles: Record<number, SeriesStyle>,
  seriesLabels: Record<number, string>,
): { styleList: (SeriesStyle | undefined)[]; labelList: (string | undefined)[] } | null {
  return useMemo(() => {
    if (!encoded || !displayPayload) return null;
    const styles = encoded.styles(seriesStyles);
    const labels = encoded.labels(seriesLabels);
    return {
      styleList: displayPayload.series.map((_, i) => styles[i]),
      labelList: displayPayload.series.map((_, i) => labels[i]),
    };
  }, [encoded, displayPayload, seriesStyles, seriesLabels]);
}
