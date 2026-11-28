// The export half of per-point text symbols (plan item 24; `lib/markerTextRows.ts`): the series' resolved row
// texts ride the wire style as `marker_texts`, aligned to the rows the request's dataset carries. A flat export
// prunes the dataset's dropped rows (`pruneToLiveDataset`), so the texts are read for the KEPT rows only, by
// their SOURCE row (a row number or letter is never a position in the pruned view, nor in a plot's row window).
// A flat, grouped, encoded or per-series-X request carries them (a split series keeps every row, masked); a facet
// grid, which cuts rows per panel, builds its own (`lib/facetMarkerTexts.ts`). Anything else draws the literal
// `marker_text`, else plain glyphs, and the backend ignores a list that does not fit its rows.

import { markerTextRows, textSourceOf } from "./markerTextRows";
import type { ExportSeriesStyle } from "./publicationStyles";
import { activeRowIndices, droppedRows } from "./rowstate";
import type { Dataset, SeriesStyle } from "./types";

/** The wire key one series' row texts ride on (`null` = no symbol on that row). */
export interface MarkerTextWire { marker_texts?: (string | null)[] }

/** What a request's rows are, for reading their texts:
 *   - `src`: the worksheet the texts are read from (its SOURCE rows number them);
 *   - `range`: the plot's row window, when one cut the request (`lib/figureRowRange`): window row k is source row
 *     `range.from + k`;
 *   - `live`: the dataset whose exclusions and filter pruned the request's rows (the window's, or a per-series-X
 *     view's), or null;
 *   - `rows`: the request dataset's row count;
 *   - `all`: the request keeps every row (an encoded request blanks excluded rows server-side) instead of the
 *     pruned view. */
export interface TextRowsRequest { src: Dataset | null | undefined; range?: { from: number; to: number } | null; live: Dataset | null | undefined; rows: number; all?: boolean }

/** `styles` (aligned to `plotted`) with each per-point text series carrying its `marker_texts`; the same
 *  reference when no plotted series asks or the request is not this sheet's view of its rows (fail closed).
 *  A per-series-X request repeats the (windowed) sheet's rows once per X block, so a row's text repeats per block. */
export function withMarkerTextWire(
  styles: (ExportSeriesStyle | null)[] | null,
  plotted: readonly number[],
  seriesStyles: Record<number, SeriesStyle>,
  req: TextRowsRequest,
): (ExportSeriesStyle | null)[] | null {
  const { src, live, range } = req;
  if (!src || !live || !plotted.some((ch) => textSourceOf(seriesStyles[ch]))) return styles;
  const total = live.data.time.length;
  const keep = req.all ? Array.from({ length: total }, (_, r) => r) : activeRowIndices(total, droppedRows(live));
  const period = range ? range.to - range.from + 1 : src.data.time.length;
  if (keep.length !== req.rows || period < 1 || total % period) return styles;
  const from = range?.from ?? 0;
  const base = styles ?? plotted.map(() => null);
  return plotted.map((ch, i) => {
    const st = seriesStyles[ch];
    const all = textSourceOf(st) && !st?.bars ? markerTextRows(src, st) : null;
    if (!all) return base[i] ?? null;
    const wire: ExportSeriesStyle & MarkerTextWire = { ...base[i], marker_texts: keep.map((r) => all[from + (r % period)] ?? null) };
    return wire;
  });
}

/** A style whose row texts were cut to the KEPT rows, padded for the `lost` rows a "grey" export appends. */
export function padMarkerTextWire<T extends ExportSeriesStyle | null>(style: T, lost: number): T {
  const w = style as (ExportSeriesStyle & MarkerTextWire) | null;
  return w?.marker_texts ? ({ ...w, marker_texts: [...w.marker_texts, ...Array<null>(lost).fill(null)] } as unknown as T) : style;
}
