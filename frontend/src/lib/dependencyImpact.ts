// LIBRARY_WORKBOOK_UX_PLAN PR M (L0.45 + L0.55): the shared "what depends on
// this" impact-preview computation for BOTH reimport and delete — squarely
// on top of the K graph foundation (lib/recalc.ts's `downstreamOf`, which
// already walks bgRef chains, ComputedColumn deps' col->col edges, and
// derivedFrom sheet chains, plus every affected fit).
//
// Pure — no store dependency, no UI. `downstreamOf` is called once per
// source id and the results unioned/deduped (a multi-id source set, e.g. a
// workbook's member worksheets, commonly shares downstream dependents).
// Members of the source set itself are excluded from the "affected" list —
// they're the thing being reimported/deleted, not a dependent of it.
//
// The `removed` option (review round, PR M): `downstreamOf` deliberately
// includes sourceId's OWN fit in `down.fits` (recalc.ts, "the fit of every
// affected dataset, including the source's own") — correct for a REIMPORT,
// where the source dataset survives with fresh data and its saved fit goes
// stale, so it belongs in the preview. It is WRONG for a DELETE: a workbook
// member's own fit isn't "marked stale", it's destroyed along with the
// worksheet, so it must not appear as an affected dependent. `sourceIds`
// alone can't tell survives-vs-removed apart (both shapes put the acted-on
// ids there), so the caller states it explicitly: reimport.ts calls with
// the default (survives); workbookContextActions.ts's delete passes
// `{ removed: true }`.

import { downstreamOf } from "./recalc";
import type { Dataset } from "./types";

export interface DependencyImpact {
  /** Names of OTHER datasets (derived worksheets, bgRef-chained corrections)
   *  that will be marked stale — never auto-recomputed (K5c's invariant). */
  affectedDatasetNames: string[];
  /** Names of datasets whose saved fit will be marked stale. */
  affectedFitNames: string[];
}

/** The full downstream closure of `sourceIds` — bgRef chains, derived
 *  worksheets, and fits — via the SAME `downstreamOf` the recalc engine
 *  itself uses, so a preview can never show something the graph wouldn't
 *  actually stale-mark (or vice versa).
 *
 *  `removed` (default false): pass `true` when `sourceIds` are being
 *  DELETED rather than reimported/edited — see the module doc's asymmetry
 *  note. It additionally strips any sourceId's own fit out of the affected
 *  fit list (survives-and-goes-stale doesn't apply once the dataset itself
 *  is gone). */
export function computeDependencyImpact(
  datasets: readonly Dataset[],
  sourceIds: readonly string[],
  options?: { removed?: boolean },
): DependencyImpact {
  const removed = options?.removed ?? false;
  const sourceSet = new Set(sourceIds);
  const affectedIds = new Set<string>();
  const affectedFitIds = new Set<string>();
  for (const id of sourceIds) {
    const down = downstreamOf(datasets, id);
    for (const dId of down.datasets) if (!sourceSet.has(dId)) affectedIds.add(dId);
    for (const fId of down.fits) {
      if (removed && sourceSet.has(fId)) continue; // destroyed with its worksheet, not staled
      affectedFitIds.add(fId);
    }
  }
  const nameOf = (id: string): string => datasets.find((d) => d.id === id)?.name ?? id;
  return {
    affectedDatasetNames: [...affectedIds].map(nameOf),
    affectedFitNames: [...affectedFitIds].map(nameOf),
  };
}

export const hasDependencyImpact = (impact: DependencyImpact): boolean =>
  impact.affectedDatasetNames.length > 0 || impact.affectedFitNames.length > 0;

/** A short, human-readable summary of `impact` for a confirm dialog message
 *  — "" when there's nothing to report (callers skip the preview entirely
 *  then, matching today's frictionless no-dependents case). */
export function formatDependencyImpact(impact: DependencyImpact): string {
  const parts: string[] = [];
  if (impact.affectedDatasetNames.length) {
    const n = impact.affectedDatasetNames.length;
    parts.push(`${n} dependent worksheet${n === 1 ? "" : "s"} (${impact.affectedDatasetNames.join(", ")}) will be marked stale, not automatically recomputed.`);
  }
  if (impact.affectedFitNames.length) {
    const n = impact.affectedFitNames.length;
    parts.push(`${n} fit${n === 1 ? "" : "s"} (${impact.affectedFitNames.join(", ")}) will be marked stale.`);
  }
  return parts.join(" ");
}
