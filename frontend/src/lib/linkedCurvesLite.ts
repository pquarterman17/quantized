// The dependency-free half of lib/linkedCurves.ts: what the EAGER code (the
// .dwk loader, the workspace merge, the stage, the export gate) needs of a live
// graph without pulling in the assembler. Pure; types only.

import type { Dataset, LinkedCurve } from "./types";

/** Why a live graph draws nothing: every curve is unresolved (deleted source,
 *  a cycle, a removed column), so the assembly has no rows. null otherwise.
 *  Such a graph never asks the backend for a plot or an export (a request
 *  with labels but no rows is a 422); the stage shows this instead. */
export const NO_CURVES_REASON = "No curves: their sources are missing";
export function emptyGraphReason(ds: Pick<Dataset, "linkedCurves" | "data">): string | null {
  return ds.linkedCurves && ds.data.time.length === 0 ? NO_CURVES_REASON : null;
}

/** What a saved curve that cannot be restored is bound to: nothing. */
export const UNRESOLVED_SOURCE = "";

/** Validate a parsed .dwk `linkedCurves` entry list. A malformed entry keeps
 *  its SLOT as an empty curve (-1, bound to no dataset) so the later curves
 *  keep their column indices (styles, renames and error keys index them). */
export function sanitizeLinkedCurves(raw: unknown): LinkedCurve[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  // -1 = the source column was removed (remapLinkedCurveSources): kept, drawn empty.
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= -1;
  const out = raw.map((c): LinkedCurve => {
    const r = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label : "";
    if (typeof r.datasetId !== "string" || !ok(r.yKey) || !(r.xKey === null || ok(r.xKey))) {
      return { datasetId: UNRESOLVED_SOURCE, xKey: null, yKey: -1, label };
    }
    const labelFrom = r.labelFrom === "name" || r.labelFrom === "nameCol" ? r.labelFrom : undefined;
    return { datasetId: r.datasetId, xKey: r.xKey, yKey: r.yKey, label, ...(labelFrom ? { labelFrom } : {}) };
  });
  return out.length ? out : undefined;
}
