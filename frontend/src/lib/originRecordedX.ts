// A2 owner decision (2026-11-20): when an Origin file RECORDS a curve's X
// column, and that X decoded, it wins over the plot's nearest-preceding-X
// rule (`lib/perSeriesX.ts` `curveX`). The rule still applies when the file
// names no X for a curve. A recorded X that did not import is never replaced
// by a guess: that curve is left out, with a diagnosis.
//
// Corpus cases: PacoSanto Etna origin.opju Graph16 records x=L for y=C, and
// Catchment A..E .opju Graph6 records x=D (Year) for y=I; the per-series view
// redrew both against another X column (D, G), off the decoded axis range.
//
// The plot pipeline binds ONE X per dataset, so a figure whose recorded X
// disagrees with the per-series view is applied through the overlay builder
// (`buildOverlayDataset(..., ownX)`), which already keys every curve by its
// own (dataset, X column) and keeps row order (multi-X and non-monotonic X
// stay protected exactly as for a multi-X figure).
//
// LAZY: only the Origin apply body (`store/originApplyRun.ts`) imports this.

import { isDefaultX } from "./originFigureSelection";
import { curveX } from "./perSeriesX";
import type { Dataset, OriginFigure } from "./types";

function columns(ds: Dataset): { meta: Record<string, unknown>; letters: string[]; xLetter: string } {
  const meta = (ds.data.metadata ?? {}) as Record<string, unknown>;
  const letters = Array.isArray(meta.origin_column_names) ? (meta.origin_column_names as unknown[]).map(String) : [];
  return { meta, letters, xLetter: String(meta.x_column_name ?? "") };
}

/** The text (category) column a layer's curves on `ds` RECORD as their X, when
 *  they are all on ONE such column that is not the book's own X: Origin plots
 *  them at category positions 1..N and prints the cells (Catchment A-E Graph1/2:
 *  recorded X = the Month text column, axis 0.5..12.5, Jan..Dec ticks, per
 *  Origin's saved preview and the decoded frame). Null otherwise -- a layer
 *  that mixes a text X with numeric-X curves is not one axis, so its text
 *  curves are left out (`recordedXOmissions`), never drawn on a guess. */
export function textXLetter(figure: OriginFigure, ds: Dataset): string | null {
  const { meta, xLetter } = columns(ds);
  const text = meta.origin_text_columns;
  if (!text || typeof text !== "object") return null;
  const book = String(meta.origin_book ?? "");
  const mine = (figure.curves ?? []).filter((c) => c.book === book);
  const isText = (c: { x?: string; xRecorded?: boolean }) =>
    !!c.x && !!c.xRecorded && !isDefaultX(meta, c.x, xLetter) && Object.prototype.hasOwnProperty.call(text, c.x);
  const first = mine.find(isText);
  return first && mine.every((c) => isText(c) && c.x === first.x) ? (first.x as string) : null;
}

/** True when some curve of `figure` on `ds` that the selection plots RECORDS
 *  an X (`OriginCurve.xRecorded`) the plot would not draw it against: the
 *  per-series view (`curveX` under the selection's `xKey`) gives it another X
 *  column. Curves whose file names no X are left to that rule. */
export function recordedXConflicts(
  figure: OriginFigure,
  ds: Dataset,
  sel: { xKey: number | null; yKeys: number[] } | null,
): boolean {
  if (textXLetter(figure, ds) !== null) return true; // category positions: never the plain X path
  if (!sel) return false;
  const { meta, letters, xLetter } = columns(ds);
  const book = String(meta.origin_book ?? "");
  const own = curveX(ds, sel.xKey);
  return (figure.curves ?? []).some((c) => {
    // Only an X the curve record itself names (`xRecorded`: the .opju token or
    // the .opj anchor). An X the reader only INFERS (nearest preceding X) is
    // no evidence: Moke.opj Graph8/9 infer x=E for y=B while Origin draws B
    // against A (the record's X) -- letting the inference win flipped the loop.
    if (c.book !== book || !c.x || !c.xRecorded) return false;
    const y = letters.indexOf(c.y);
    if (y < 0 || !sel.yKeys.includes(y)) return false;
    const recorded = isDefaultX(meta, c.x, xLetter) ? null : letters.indexOf(c.x);
    if (recorded === -1) return false; // unproven: left out, see recordedXOmissions
    const drawn = own[y] === undefined ? sel.xKey : own[y];
    return drawn !== recorded;
  });
}

/** One line per curve of `figure` on `ds` whose RECORDED X column did not
 *  import (no channel, not the book's X): such a curve is left out, never
 *  redrawn against a nearby X. */
export function recordedXOmissions(figure: OriginFigure, ds: Dataset): string[] {
  const { meta, letters, xLetter } = columns(ds);
  const book = String(meta.origin_book ?? "");
  const category = textXLetter(figure, ds);
  return (figure.curves ?? [])
    .filter((c) => c.book === book && !!c.x && !!c.xRecorded && letters.includes(c.y)
      && !isDefaultX(meta, c.x, xLetter) && !letters.includes(c.x) && c.x !== category)
    .map((c) => `${c.book} column ${c.y} (X ${c.x})`);
}
