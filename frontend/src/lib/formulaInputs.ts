// Class B hardening (SILENT_STATE_CORRUPTION_PLAN #2): `recomputeWithErrors`
// (lib/formula.ts) STRIPS the last `formulas.length` columns from whatever
// DataStruct it's handed, then reapplies them from scratch — correct ONLY
// when that DataStruct already carries its own stale computed columns
// (store/cellEdit.ts's edited `d.data`, store/corrections.ts's freshly-
// corrected-then-re-recomputed `d.data`). A bare/fresh base table — a
// reimport's freshly re-read file (store/reimport.ts, #245), a derived
// worksheet's just-corrected SOURCE table (store/derivedWorksheets.ts, #4)
// — has never had those columns appended, so the strip eats real base
// columns instead of stale computed ones. Both #245 and #4 were exactly
// this: a plain `DataStruct` cannot say which situation it's in, so a wrong
// caller compiled and ran silently.
//
// `StrippableData` turns that precondition into a type instead of a
// comment: it's a `DataStruct` plus a marker property keyed by a
// module-private `unique symbol`, which no ordinary object literal or
// existing `DataStruct` value can ever satisfy structurally. The ONLY way
// to produce one is `asAlreadyComputed`, an explicit, named, deliberately
// unchecked assertion — call it exclusively where the caller can actually
// vouch for the provenance. Today that's two call sites, both of which only
// ever receive a Dataset's OWN `.data` (never a bare/fresh base table):
// store/useApp.ts's `recompute` helper (the full, every-row path), and
// store/cellEdit.ts's `recomputeAfterCellEdit` (the row-local incremental
// fast path, lib/formulaIncremental.ts's `computeFormulasIncremental`).
//
// A caller with base-only data should reach for `recomputeFromBase` below
// (or `applyFormulas` directly, if it doesn't need the per-column error
// state) instead of asserting a lie through `asAlreadyComputed`.

import { applyFormulas, formulaErrors } from "./formula";
import type { ComputedColumn, DataStruct } from "./types";

declare const COMPUTED_BRAND: unique symbol;

/** A `DataStruct` known — by the caller's own construction, never by
 *  inspecting it — to already carry its formulas' computed columns. The
 *  only input `recomputeWithErrors` (lib/formula.ts) may strip. */
export type StrippableData = DataStruct & { readonly [COMPUTED_BRAND]: true };

/** The one sanctioned way to produce a `StrippableData`: an explicit, named
 *  assertion — never a structural coincidence — that `data` already carries
 *  its own stale computed columns and is safe to strip-and-reapply. Call
 *  this ONLY where that is actually true (see module doc); everywhere else,
 *  `recomputeFromBase` is the honest choice. */
export function asAlreadyComputed(data: DataStruct): StrippableData {
  return data as StrippableData;
}

/** Apply `formulas` fresh onto a BASE-ONLY `DataStruct` — the never-strips
 *  counterpart to `recomputeWithErrors`, for a caller whose `data` does NOT
 *  already carry the stale computed columns a strip-and-reapply would need
 *  (a reimport's fresh base table, a derived worksheet's just-corrected
 *  SOURCE table — see module doc). Mirrors `recomputeWithErrors`'s
 *  data+errors-together shape (K5b's reasoning: the two must never be
 *  computed by paths that can silently disagree) without ever touching
 *  `baseColumns`. */
export function recomputeFromBase(
  base: DataStruct,
  formulas: ComputedColumn[],
): { data: DataStruct; errors: Record<string, string> } {
  return { data: applyFormulas(base, formulas), errors: formulaErrors(base, formulas) };
}

/** `recomputeFromBase`, collapsed into the `{ data, formulaErrors }` patch
 *  shape `store/useApp.ts`'s `recompute` helper produces (SILENT_STATE_
 *  CORRUPTION_PLAN #6) — for a caller with a freshly-corrected BASE table
 *  (never a dataset's own `.data`, which `recompute` already handles) that
 *  needs to reapply `formulas` without stripping: `store/corrections.ts`'s
 *  `applyCorrections`/`resetCorrections`, whose `raw` is always base-only
 *  (#6). No formulas = `base` verbatim, errors cleared — the same "nothing
 *  to recompute" shape `recompute` returns for a formula-less dataset. */
export function recomputeFromBaseOrEmpty(
  base: DataStruct,
  formulas: ComputedColumn[] | undefined,
): { data: DataStruct; formulaErrors: Record<string, string> | undefined } {
  if (!formulas?.length) return { data: base, formulaErrors: undefined };
  const { data, errors } = recomputeFromBase(base, formulas);
  return { data, formulaErrors: Object.keys(errors).length ? errors : undefined };
}

/** Drop `cat_levels` (P1.4, column-index-keyed) entries at/beyond `keep`
 *  (SILENT_STATE_CORRUPTION_PLAN #8): `lib/formula.ts`'s `baseColumns`
 *  slices `labels`/`units`/`values` down to `keep` columns but, without
 *  this, spread the FULL level table through unchanged — so a stripped
 *  categorical column's table survived into the "base" it was stripped out
 *  of, ready to re-land on whatever plain formula column `computeFormulas`
 *  next assigns that same index. Lives here (not lib/formula.ts, which sits
 *  at its 500-line ceiling) purely for headroom. Returns `undefined` for an
 *  absent or now-empty table — `baseColumns` must never carry forward a
 *  stale `{}`. */
export function stripCatLevels(
  levels: Record<number, string[]> | undefined,
  keep: number,
): Record<number, string[]> | undefined {
  if (!levels) return undefined;
  const out: Record<number, string[]> = {};
  for (const [key, list] of Object.entries(levels)) {
    if (Number(key) < keep) out[Number(key)] = list;
  }
  return Object.keys(out).length ? out : undefined;
}
