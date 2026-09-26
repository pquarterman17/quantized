// Bounded live preview for the Reshape & combine workshop (P2.5 review
// finding 5). `computeTransform` (lib/transformRun.ts) is the exact,
// full-fidelity compute Create/replay must run — but `useReshapePreview.ts`
// used to run THAT SAME full compute on every debounced edit, which means
// every keystroke materialized the whole result (append/join/stack can each
// reach millions of rows) just to show a ~20-row table.
//
// `computeTransformPreview` runs the SAME operations, but bounded:
//  - append/stack/unstack: truncate each INPUT to its first `PREVIEW_CAP`
//    rows first ("take the head of each input"), then run the real,
//    unmodified transform on that small slice — the column layout, unit/
//    categorical handling and provenance are identical, only the row COUNT
//    differs. When every input is already `<= PREVIEW_CAP` rows (true of
//    every existing test fixture) this is a no-op and the preview is EXACT.
//  - join: `joinWorksheets`'s own `limit` param (lib/worksheetJoin.ts) caps
//    the OUTPUT after the (cheap, input-row-sized) key/duplicate/unmatched
//    accounting is already done, so a big join's ROW MATERIALIZATION is
//    capped without under-counting a single warning.
//  - transpose: passed straight to `computeTransform` — it already has its
//    own hard caps (<=2,000 rows, <=5,000,000 cells), which is "bounded
//    sensibly" on its own; truncating its input would also change its
//    OUTPUT COLUMN COUNT (transpose swaps the axes), a worse preview/commit
//    mismatch than the cost it would save.
//
// WARNINGS are always computed from the FULL, untruncated inputs — an
// analyzer never materializes the transform's own output, so this was never
// the expensive part, and truncating it would make the very thing a preview
// exists to surface (a duplicate key, a unit mismatch, a dropped column) less
// accurate right when the user is deciding whether to Create.
//
// When truncation actually happened, `TransformPreview.previewCapped` is set
// so `ReshapePanel.tsx` can say so ("Preview shows the first N rows") next to
// its own row/column count — "exact parity between preview and commit" is
// not claimed for a truncated op. This never reaches the confirm dialog
// Create shows on a warning mismatch: that dialog's `TransformPreview` is
// built by `runTransform`'s OWN fresh, uncapped `computeTransform` call, not
// this module's; the two objects meet only at `useReshapePreview.ts`'s
// `samePreview` gate, which compares WARNINGS, never the row data, so a
// truncated preview still reviews correctly at Create.

import { analyzeMerge } from "./appendWarnings";
import { mergeDatasets } from "./merge";
import { sliceRowSidecars } from "./rowSidecars";
import {
  computeTransform,
  preview,
  rowsOf,
  type TransformComputed,
  type TransformParams,
  type TransformPreview,
} from "./transformRun";
import { analyzeJoin, analyzeStack, analyzeUnstack } from "./transformWarnings";
import type { DataStruct, Dataset } from "./types";
import { joinWorksheets } from "./worksheetJoin";
import { stackWorksheet, unstackWorksheet } from "./worksheetTransforms";

/** Rows read from each input before materializing append/join/stack/unstack
 *  for the LIVE preview — generous enough that a real single-dataset preview
 *  (the common case) is exact far more often than not, tiny next to a
 *  multi-million-row worksheet. */
export const PREVIEW_CAP = 20;

/** `ds`'s first `n` rows — numeric grid AND row-indexed text sidecars kept
 *  aligned (`lib/rowSidecars.ts`'s `sliceRowSidecars`, the SAME slicer
 *  `lib/facet.ts`/`lib/rowstate.ts` use for "keep a row subset"). Returns
 *  `ds` itself, unchanged, when it is already `<= n` rows — the common case
 *  for every existing test fixture, and the reason a small preview is exact
 *  rather than merely close. */
function headOfDataStruct(ds: DataStruct, n: number): DataStruct {
  if (ds.time.length <= n && ds.values.length <= n) return ds;
  const rows = Math.min(n, Math.max(ds.time.length, ds.values.length));
  const rowIndexes = Array.from({ length: rows }, (_, i) => i);
  return { ...ds, time: ds.time.slice(0, n), values: ds.values.slice(0, n), metadata: sliceRowSidecars(ds.metadata, rowIndexes) };
}

/** Marks `pv` as capped when truncation actually happened — never when the
 *  preview turned out exact anyway (every existing small fixture). Read by
 *  `ReshapePanel.tsx` to show "Preview shows the first N rows"; `pv.summary`
 *  itself is untouched (it is a Create-time confirm-dialog string that this
 *  bounded preview object never reaches — see this module's header). */
function withCapNote(pv: TransformPreview, truncated: boolean): TransformPreview {
  return truncated ? { ...pv, previewCapped: true } : pv;
}

/** The bounded counterpart to `computeTransform`, for `useReshapePreview.ts`'s
 *  debounced live preview ONLY — Create and pipeline replay always call
 *  `computeTransform` itself, uncapped. Same params/return shape, so it is a
 *  straight swap at that one call site. */
export async function computeTransformPreview(p: TransformParams, primary: Dataset, others: Dataset[]): Promise<TransformComputed> {
  const src = rowsOf(primary);
  switch (p.op) {
    case "stack": {
      const capped = headOfDataStruct(src, PREVIEW_CAP);
      const data = stackWorksheet(capped, p.channels);
      const pv = preview("Stack columns", data, analyzeStack(src, p.channels), [[primary.name, src]]);
      return { data, name: `${primary.name} (stacked)`, preview: withCapNote(pv, capped !== src) };
    }
    case "unstack": {
      const capped = headOfDataStruct(src, PREVIEW_CAP);
      const data = unstackWorksheet(capped, p.key, p.category, p.value, p.aggregate);
      const pv = preview("Unstack", data, analyzeUnstack(src, p.key, p.category, p.value, p.aggregate), [[primary.name, src]]);
      return { data, name: `${primary.name} (unstacked)`, preview: withCapNote(pv, capped !== src) };
    }
    case "join": {
      const right = others[0];
      const rsrc = rowsOf(right);
      const keyMode = p.keyMode ?? "code";
      const data = joinWorksheets(src, rsrc, p.leftKey, p.rightKey, p.mode, keyMode, PREVIEW_CAP);
      const w = analyzeJoin(src, rsrc, p.leftKey, p.rightKey, p.mode, primary.name, right.name, keyMode);
      const pv = preview(`Join (${p.mode})`, data, w, [[primary.name, src], [right.name, rsrc]]);
      return {
        data,
        name: `${primary.name} + ${right.name} (joined)`,
        preview: withCapNote(pv, typeof data.metadata.preview_truncated_from === "number"),
      };
    }
    case "merge": {
      const all = [primary, ...others];
      const names = all.map((d) => d.name);
      // Merge/algebra have always read `.data` directly, never the analysis
      // rows (lib/transformRun.ts's own `rowsOf` doc) — matched here too.
      const fulls = all.map((d) => d.data);
      const capped = fulls.map((d) => headOfDataStruct(d, PREVIEW_CAP));
      const data = mergeDatasets(capped, names, p.match);
      const pv = preview(`Append ${all.length} datasets`, data, analyzeMerge(fulls, names, p.match), all.map((d, i) => [d.name, fulls[i]]));
      return { data, name: `merged (${all.length})`, preview: withCapNote(pv, capped.some((d, i) => d !== fulls[i])) };
    }
    // transpose (module doc), and any op this workshop never opens on
    // (algebra/resample/split) — the full compute already IS the sensible
    // bound, or is simply unreachable from here.
    default:
      return computeTransform(p, primary, others);
  }
}
