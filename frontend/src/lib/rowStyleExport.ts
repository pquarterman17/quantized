// "Use row states" (G24), the colour resolution both renderers share and the
// export half. A row cell (lib/rowStyle.ts) is a theme slot (`s1`..`s8`) or a
// literal hex; `rowHex` resolves it through `--series-N`, ONCE, and BOTH the
// canvas (`lib/rowStyleSpecs.ts` -> `ColorScatterSpec.fills`) and the export
// (`row_colors` below -> `calc/figure_row_states.py`) paint that exact hex, so
// the two cannot disagree (no contrast shift on either side, unlike a series
// stroke: a per-point colour is data, and paper and screen must match).
//
// The export carries the per-row arrays on the series' wire style, aligned to
// the rows the request's dataset carries: a flat export prunes the dataset's
// dropped rows (`pruneToLiveDataset`), so the arrays are pruned through the
// same kept-row list. Only the flat, live-dataset request carries them; a
// grouped, encoded or faceted request, or a frozen document without its
// dataset, does not (provisional, owner to confirm; the backend ignores an
// array whose length does not match its rows).

import { resolveToHex } from "./color";
import { usableRowStyle } from "./rowStyle";
import { activeRowIndices, droppedRows } from "./rowstate";
import { seriesColor } from "./seriesStyleCycle";
import type { ExportSeriesStyle } from "./publicationStyles";
import type { Dataset, SeriesStyle } from "./types";

/** The wire keys one series' row states ride on. `""`-free: null = no state. */
export interface RowStateWire {
  row_colors?: (string | null)[];
  row_markers?: (string | null)[];
}

/** A row cell as one `#rrggbb` hex (null for "" or an unresolvable token). */
export function rowHex(cell: string | undefined): string | null {
  if (!cell) return null;
  if (cell[0] === "#") return cell.toLowerCase();
  const c = seriesColor(Number(cell.slice(1)) - 1);
  return resolveToHex(c) ?? (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);
}

/** `styles` (aligned to `plotted`) with each row-states series carrying its
 *  per-row hex colours and marker shapes, over `ds`'s rows less its dropped
 *  ones; `rows` is the request's row count, which must be that pruned view's.
 *  Unchanged (same reference) when no plotted series asks for them. */
export function withRowStateWire(
  styles: (ExportSeriesStyle | null)[] | null,
  plotted: readonly number[],
  seriesStyles: Record<number, SeriesStyle>,
  ds: Dataset | null | undefined,
  rows: number,
): (ExportSeriesStyle | null)[] | null {
  const rs = usableRowStyle(ds);
  if (!rs || !ds || !plotted.some((ch) => seriesStyles[ch]?.rowStates)) return styles;
  const keep = activeRowIndices(ds.data.time.length, droppedRows(ds));
  if (keep.length !== rows) return styles; // the request is not this dataset's pruned view: fail closed
  const colors = rs.color && keep.map((r) => rowHex(rs.color?.[r]));
  const markers = rs.marker && keep.map((r) => rs.marker?.[r] || null);
  const base = styles ?? plotted.map(() => null);
  return plotted.map((ch, i) => {
    const st = seriesStyles[ch];
    if (!st?.rowStates || st.colorBy != null || st.sizeBy != null) return base[i] ?? null; // as the canvas (lib/rowStyleSpecs.ts)
    const wire: ExportSeriesStyle & RowStateWire = { ...base[i], ...(colors ? { row_colors: colors } : {}), ...(markers ? { row_markers: markers } : {}) };
    return wire;
  });
}

/** A series style whose row arrays were cut to the KEPT rows, padded for the
 *  `lost` rows a "grey" export appends after them (`excludedRowsExport.
 *  withExcludedGhosts` lays the dataset out as kept rows, then the lost ones,
 *  whose main series are blank): the lost rows hold no state. */
export function padRowStateWire<T extends ExportSeriesStyle | null>(style: T, lost: number): T {
  const w = style as (ExportSeriesStyle & RowStateWire) | null;
  if (!w?.row_colors && !w?.row_markers) return style;
  const pad = (a: (string | null)[]): (string | null)[] => [...a, ...Array<null>(lost).fill(null)];
  return { ...w, ...(w.row_colors ? { row_colors: pad(w.row_colors) } : {}), ...(w.row_markers ? { row_markers: pad(w.row_markers) } : {}) } as T;
}
