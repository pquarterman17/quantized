// Per-point text symbols on a FACET GRID (plan item 24; lazy, in the marks chunk). A panel holds only its level's
// rows, so each panel reads its texts by the SOURCE row behind each of its points:
//
//   panel point j  ->  `panel.rows[j]` (a row of the data the panels were cut from: the sheet's analysis view)
//                  ->  that view's dataset row (`analysisRowIds`; the identity when nothing is dropped)
//                  ->  the sheet row (`+ offset` when the plot's row window cut the sheet, `range.from`).
//
// The screen (`Stage/useFacetTextStyles`) and the export (`figureSpecFacets`) both come through here, so a letter
// or a row number is the worksheet's row number in both. A grid whose panels do not line up with the sheet (hand
// built panels, a stale partition) draws no per-point text rather than the wrong one: the check compares each
// panel's x with the sheet's. A grid split by a group or an encoding, or one that greys excluded rows, is refused
// by `facetTextRefusal` (the panels' series are then not one per channel).

import type { FigureFacetSpec } from "./api/figures";
import { facetPayloads, type FacetPanel } from "./facet";
import { markerTextRows, textSourceOf, type TextRowsStyle } from "./markerTextRows";
import { activeRowIndices, droppedRows, pruneToLiveDataset } from "./rowstate";
import type { DataStruct, Dataset, SeriesStyle } from "./types";

/** Why a facet grid draws no per-point text, or null when it can. */
export function facetTextRefusal(o: { split: boolean; grey: boolean }): string | null {
  if (o.split) return "Text symbols are not drawn on a facet grid split by a group or an encoding.";
  return o.grey ? "Text symbols are not drawn on a facet grid that greys excluded rows." : null;
}

/** `panel`'s rows as sheet rows, or null when they do not line up with `view` (the dataset the panels were cut
 *  from) at the panel's x column `xKey` (null = the time column). */
export function panelSheetRows(
  panel: Pick<FacetPanel, "rows" | "payload">,
  view: Dataset,
  xKey: number | null,
  offset: number,
): number[] | null {
  const rows = panel.rows;
  const xs = panel.payload.data[0] as ArrayLike<number | null | undefined>;
  if (!rows || rows.length !== xs.length) return null;
  const ids = activeRowIndices(view.data.time.length, droppedRows(view));
  const out: number[] = [];
  for (let j = 0; j < rows.length; j++) {
    const r = ids[rows[j]];
    if (r === undefined) return null;
    const want = xKey === null ? view.data.time[r] : view.data.values[r]?.[xKey];
    const got = xs[j];
    if (Number.isFinite(want) !== Number.isFinite(got ?? NaN) || (Number.isFinite(want) && want !== got)) return null;
    out.push(offset + r);
  }
  return out;
}

/** Each panel's style list (aligned to its `channels`) with per-point texts for the series that ask, or null when
 *  no plotted channel asks or no panel can read its rows. `view` is the sheet the panels were cut from (the
 *  windowed one), `src` the whole sheet the texts number (`view` itself without a window), `offset` the window's
 *  first row. */
export function facetTextStyles(
  panels: readonly FacetPanel[],
  styles: Record<number, SeriesStyle>,
  view: Dataset,
  src: Dataset,
  xKey: number | null,
  offset: number,
): (SeriesStyle | undefined)[][] | null {
  if (!panels.some((p) => p.channels.some((ch) => textSourceOf(styles[ch])))) return null;
  let any = false;
  const out = panels.map((p) => {
    const sheet = panelSheetRows(p, view, xKey, offset);
    return p.channels.map((ch) => {
      const st = styles[ch];
      const all = sheet && textSourceOf(st) && !st?.bars ? markerTextRows(src, st) : null;
      if (!all || !sheet) return st;
      any = true;
      const texts = sheet.map((r) => all[r] ?? null);
      const first = texts.find((t) => t?.trim())?.trim();
      return { ...st, markerTexts: texts, markerText: first ? Array.from(first)[0] : st?.markerText } as TextRowsStyle;
    });
  });
  return any ? out : null;
}

/** What a facet request needs to read its panels' texts (see `withFacetTexts`). */
export interface FacetTextRequest {
  /** The request's data after the row window, before the exclusion prune. */
  data: DataStruct;
  facetCol: number;
  xKey: number | null;
  yKeys: number[] | null;
  /** The sheet the texts number, the window's dataset (its exclusions prune `data`), and the window's first row. */
  src: Dataset;
  live: Dataset;
  offset: number;
  styles: Record<number, SeriesStyle>;
}

/** `facets` (`buildFacetSpecs`' panels, one per level) with each series' wire style carrying its `marker_texts`,
 *  aligned to the panel's rows: the panels' rows are re-derived through the same `facetPayloads` the grid and
 *  `buildFacetSpecs` use, and read as sheet rows through the request's exclusion prune. The same reference when no
 *  series asks, or when the panels do not line up (fail closed: the backend then says the list does not fit). */
export function withFacetTexts(facets: readonly FigureFacetSpec[], req: FacetTextRequest): readonly FigureFacetSpec[] {
  const { live, src, offset, styles } = req;
  if (offset + live.data.time.length > src.data.time.length) return facets; // not this sheet's rows (a per-series-X view repeats them)
  const panels = facetPayloads(pruneToLiveDataset(req.data, live), req.facetCol, req.xKey, req.yKeys);
  if (panels.length !== facets.length || panels.some((p, i) => p.label !== facets[i].label)) return facets;
  const kept = activeRowIndices(live.data.time.length, droppedRows(live));
  let any = false;
  const out = facets.map((f, i) => ({
    ...f,
    series: f.series.map((s, j) => {
      const st = styles[panels[i].channels[j]];
      const all = textSourceOf(st) && !st?.bars ? markerTextRows(src, st) : null;
      if (!all) return s;
      any = true;
      const marker_texts = (panels[i].rows ?? []).map((r) => all[offset + (kept[r] ?? -1)] ?? null);
      return { ...s, style: { ...s.style, marker_texts } };
    }),
  }));
  return any ? out : facets;
}
