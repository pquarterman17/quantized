// Per-point text symbols (plan item 24, Origin's Plot Details > Symbol > Unicode): the text each ROW of a
// series carries, from `SeriesStyle.markerTextFrom`. Lazy (the marks chunk and the export request builder).
//
//   "letters"  A, B, C ... Z, AA, AB ... by the SOURCE row (row 1 is "A"), so a point keeps its letter when
//              a filter or an exclusion hides the rows before it;
//   "rows"     the 1-based SOURCE worksheet row number as text;
//   a number   the text of that channel (a category name, or the number to 6 significant digits) on the row;
//   { name }   the text of that text column; a blank cell is `null`.
//
// "Source row" is the worksheet row, never a position in a filtered or pruned view. A dataset whose rows are
// a SAMPLED preview of a lazily loaded book maps each preview row to its source row (`resolvedSourceRow`); a
// row with no known source row is `null` (nothing drawn), never a guess.
//
// The result is aligned to `ds.data` rows (a per-series-X view repeats them once per X block). The canvas reads it from the derived `markerTexts` field of the
// series style (`withMarkerTexts`, called by `Stage/usePlotPayload`); the export request carries the same
// array on the wire style (`markerTextWire`), pruned to the rows the request holds. `uplotTextSymbols` and
// `calc/figure_text_symbols.py` draw it by one rule, pinned by `tests/fixtures/wire/marker_text_rows.json`.

import { labelTexter } from "./pointLabelText";
import { resolvedSourceRow } from "./sourceRow";
import type { Dataset, SeriesStyle } from "./types";

/** A series style with its resolved per-row texts (derived, never stored). */
export type TextRowsStyle = SeriesStyle & { markerTexts?: readonly (string | null)[] };

/** Spreadsheet-style letters for `n` >= 1: 1 A, 26 Z, 27 AA, 52 AZ, 53 BA, 702 ZZ, 703 AAA. */
export function lettersOf(n: number): string {
  let out = "";
  for (let k = Math.floor(n); k > 0; k = Math.floor((k - 1) / 26)) out = String.fromCharCode(65 + ((k - 1) % 26)) + out;
  return out;
}

/** Does `style` ask for per-point text that can be read (a known source, with its column when needed)? */
export function textSourceOf(style: SeriesStyle | undefined): "letters" | "rows" | "col" | null {
  const from = style?.markerTextFrom;
  if (from === "letters" || from === "rows") return from;
  const named = typeof from === "object" && from !== null && typeof from.name === "string" && from.name !== "";
  return named || (Number.isInteger(from) && (from as number) >= 0) ? "col" : null;
}

const cache = new WeakMap<object, Map<string, (string | null)[]>>();

/** The text of every row of `ds` for `style`'s source, or null when the style has none (or its column is gone). */
export function markerTextRows(ds: Dataset, style: SeriesStyle | undefined): (string | null)[] | null {
  const from = textSourceOf(style);
  if (!from || !style) return null;
  const src = style.markerTextFrom;
  const key = `${typeof src === "object" ? `n:${src.name}` : src}|${ds.pending ? "p" : ""}`;
  const mine = cache.get(ds.data) ?? new Map<string, (string | null)[]>();
  cache.set(ds.data, mine);
  const hit = mine.get(key);
  if (hit) return hit;
  const n = ds.data.time.length;
  let out: (string | null)[];
  if (from === "col") {
    const name = typeof src === "object" ? src.name : undefined;
    if (name === undefined && (src as number) >= (ds.data.values[0]?.length ?? 0)) return null; // the column no longer exists
    const text = labelTexter(ds.data, name === undefined ? (src as number) : -1, name);
    out = Array.from({ length: n }, (_, r) => text(r));
  } else {
    out = Array.from({ length: n }, (_, r) => {
      const src = resolvedSourceRow(ds, r);
      return src == null ? null : from === "rows" ? String(src + 1) : lettersOf(src + 1);
    });
  }
  mine.set(key, out);
  return out;
}

/** `list` (display-series styles) with each per-point style carrying its resolved `markerTexts`. The same
 *  array comes back when nothing asks. `columns` are the payload's columns and must be the dataset's rows, or
 *  that many rows repeated in whole blocks (a per-series-X view lays the sheet out once per X block, so a
 *  row's text repeats per block). A group split, an encoding or a legend source masks each series' cells but
 *  keeps every row, so those series read their text by row exactly as a flat one. Any other length (rows that
 *  were reduced) has no row to read a text from: the series then keeps its plain glyph. */
export function withMarkerTexts(
  list: (SeriesStyle | undefined)[],
  plotted: readonly number[],
  ds: Dataset | null | undefined,
  columns: ArrayLike<ArrayLike<unknown>>,
): (SeriesStyle | undefined)[] {
  const n = ds?.data.time.length ?? 0;
  const len = columns[0]?.length ?? 0;
  if (!ds || n === 0 || len < n || len % n || !list.some((s) => s?.markerTextFrom)) return list;
  return list.map((s, i) => {
    if (!s?.markerTextFrom || i >= plotted.length) return s;
    const rows = markerTextRows(ds, s);
    const texts = rows && len > n ? Array.from({ length: len }, (_, r) => rows[r % n]) : rows;
    const first = texts?.find((t) => t?.trim())?.trim();
    // `markerText` becomes the first character: the legend swatch (an eager reader) draws it, as the export does.
    return texts ? ({ ...s, markerTexts: texts, markerText: first ? Array.from(first)[0] : s.markerText } as TextRowsStyle) : s;
  });
}
