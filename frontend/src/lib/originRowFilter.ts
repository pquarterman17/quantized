// Owner decision 2026-11-24 (ledger B-37, plan item 43): an imported curve
// from a book with an Origin worksheet data filter draws ONLY the rows the
// decoded condition keeps. The backend (`opju_curve_row_filter.py`) attaches
// the condition as `OriginCurve.rowFilter` only when its comparison is proven
// (op `>`, strict); every unproven one (op `<`: `<` vs `<=` open) stays left
// out with the `worksheet_filter` note.
//
// The curve is drawn through the overlay builder from a COPY of its book that
// holds only the passing rows (`rowFilteredView`), in their original order
// (non-monotonic X stays protected), so the book itself keeps every row. The
// condition is evaluated on the book's current values, as Origin's filter is.
// Any curve the overlay cannot honour is skipped, never drawn with all rows:
// `figureChannelSelection` leaves `rowFilter` curves out of the plain path.
//
// LAZY: only `lib/originOverlayFigure.ts` (the lazy apply body) imports this.

import { sliceRowSidecars } from "./rowSidecars";
import type { Dataset, OriginCurve, OriginFigure } from "./types";

/** An Origin worksheet data filter on one column of the curve's own book (its
 *  short name; the X column reads the time channel): a row is kept when its
 *  value `op` `value` (`inclusive`: a value equal to it is kept too). */
export type OriginRowFilter = NonNullable<OriginCurve["rowFilter"]>;

/** Does row value `v` pass `f`? A non-finite value never passes. */
export function rowPasses(v: number, f: OriginRowFilter): boolean {
  if (!Number.isFinite(v)) return false;
  if (f.inclusive && v === f.value) return true;
  if (f.op === ">") return v > f.value;
  if (f.op === "<") return v < f.value;
  return false;
}

/** The 0-based rows of `ds` that `f` keeps, or null when the filter column is
 *  not one column of the book or the comparison is not one this reads. */
export function keptRows(ds: Dataset, f: OriginRowFilter): number[] | null {
  if ((f.op !== ">" && f.op !== "<") || typeof f.inclusive !== "boolean" || !Number.isFinite(f.value)) return null;
  const meta = (ds.data.metadata ?? {}) as Record<string, unknown>;
  const names = Array.isArray(meta.origin_column_names) ? (meta.origin_column_names as unknown[]).map(String) : [];
  const isX = f.column !== "" && f.column === String(meta.x_column_name ?? "");
  const ch = names.indexOf(f.column);
  if (!isX && (ch < 0 || names.lastIndexOf(f.column) !== ch)) return null;
  const out: number[] = [];
  const n = ds.data.time.length;
  for (let r = 0; r < n; r++) {
    const v = isX ? ds.data.time[r] : (ds.data.values[r]?.[ch] ?? NaN);
    if (rowPasses(v, f)) out.push(r);
  }
  return out;
}

const filterKey = (f: OriginRowFilter) => `${f.column}|${f.op}|${f.value}|${f.inclusive ? 1 : 0}`;

/** A memo of filtered book copies for one overlay build: curves of the same
 *  book and condition share ONE copy, so they share one overlay X block. */
export function rowFilteredViews(): (ds: Dataset, f: OriginRowFilter) => Dataset | null {
  const memo = new Map<string, Dataset | null>();
  return (ds, f) => {
    const key = `${ds.id}#rows:${filterKey(f)}`;
    if (memo.has(key)) return memo.get(key) ?? null;
    const keep = keptRows(ds, f);
    const view: Dataset | null = keep && keep.length
      ? {
          ...ds,
          id: key,
          data: {
            ...ds.data,
            metadata: sliceRowSidecars((ds.data.metadata ?? {}) as Record<string, unknown>, keep),
            time: keep.map((r) => ds.data.time[r]),
            values: keep.map((r) => ds.data.values[r]),
          },
        }
      : null;
    memo.set(key, view);
    return view;
  };
}

/** True when some curve of `figure` (or of `other`) carries a row filter. */
export function hasRowFilter(...figures: (OriginFigure | undefined)[]): boolean {
  return figures.some((fig) => (fig?.curves ?? []).some((c: OriginCurve) => !!c.rowFilter));
}
