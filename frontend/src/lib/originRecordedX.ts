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

/** True when some curve of `figure` on `ds` that the selection plots RECORDS
 *  an X (`OriginCurve.xRecorded`) the plot would not draw it against: the
 *  per-series view (`curveX` under the selection's `xKey`) gives it another X
 *  column. Curves whose file names no X are left to that rule. */
export function recordedXConflicts(
  figure: OriginFigure,
  ds: Dataset,
  sel: { xKey: number | null; yKeys: number[] },
): boolean {
  const { meta, letters, xLetter } = columns(ds);
  const book = String(meta.origin_book ?? "");
  const own = curveX(ds, sel.xKey);
  return (figure.curves ?? []).some((c) => {
    // Only an X the curve record itself names (`.opju`, `xRecorded`). A `.opj`
    // curve's X is INFERRED by the reader (nearest preceding X) and is no
    // evidence: Moke.opj Graph8/9 infer x=E for y=B while Origin draws B
    // against A -- letting it win flipped the loop.
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
  return (figure.curves ?? [])
    .filter((c) => c.book === book && !!c.x && letters.includes(c.y)
      && !isDefaultX(meta, c.x, xLetter) && !letters.includes(c.x))
    .map((c) => `${c.book} column ${c.y} (X ${c.x})`);
}
