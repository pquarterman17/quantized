// The export half of per-point text symbols (plan item 24; `lib/markerTextRows.ts`): the series' resolved row
// texts ride the wire style as `marker_texts`, aligned to the rows the request's dataset carries. A flat export
// prunes the dataset's dropped rows (`pruneToLiveDataset`), so the texts are read for the KEPT rows only, by
// their SOURCE row (a row number or letter is never a position in the pruned view). Like the row states
// (`lib/rowStyleExport.ts`), only the flat, live-dataset request carries them; anything else draws the
// literal `marker_text`, else plain glyphs, and the backend ignores a list that does not fit its rows.

import { markerTextRows, textSourceOf } from "./markerTextRows";
import type { ExportSeriesStyle } from "./publicationStyles";
import { activeRowIndices, droppedRows } from "./rowstate";
import type { Dataset, SeriesStyle } from "./types";

/** The wire key one series' row texts ride on (`null` = no symbol on that row). */
export interface MarkerTextWire { marker_texts?: (string | null)[] }

/** `styles` (aligned to `plotted`) with each per-point text series carrying its `marker_texts`; the same
 *  reference when no plotted series asks. `rows` is the request's row count, which must be the pruned view's. */
export function withMarkerTextWire(
  styles: (ExportSeriesStyle | null)[] | null,
  plotted: readonly number[],
  seriesStyles: Record<number, SeriesStyle>,
  ds: Dataset | null | undefined,
  rows: number,
): (ExportSeriesStyle | null)[] | null {
  if (!ds || !plotted.some((ch) => textSourceOf(seriesStyles[ch]))) return styles;
  const keep = activeRowIndices(ds.data.time.length, droppedRows(ds));
  if (keep.length !== rows) return styles; // the request is not this dataset's pruned view: fail closed
  const base = styles ?? plotted.map(() => null);
  return plotted.map((ch, i) => {
    const st = seriesStyles[ch];
    const all = textSourceOf(st) && !st?.bars ? markerTextRows(ds, st) : null;
    if (!all) return base[i] ?? null;
    const wire: ExportSeriesStyle & MarkerTextWire = { ...base[i], marker_texts: keep.map((r) => all[r]) };
    return wire;
  });
}

/** A style whose row texts were cut to the KEPT rows, padded for the `lost` rows a "grey" export appends. */
export function padMarkerTextWire<T extends ExportSeriesStyle | null>(style: T, lost: number): T {
  const w = style as (ExportSeriesStyle & MarkerTextWire) | null;
  return w?.marker_texts ? ({ ...w, marker_texts: [...w.marker_texts, ...Array<null>(lost).fill(null)] } as unknown as T) : style;
}
