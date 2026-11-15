// The .dwk reader's validation of a live graph's curve list.
// Bundle diet (origin gap audit 3 #15's funding): moved verbatim out of
// lib/linkedCurvesLite.ts, whose other exports run at startup; only lazy modules
// call this half, so it no longer ships in the startup chunk. Imported by
// path; lib/linkedCurvesLite.ts does not re-export it.

import { UNRESOLVED_SOURCE } from "./linkedCurvesLite";
import type { LinkedCurve } from "./types";

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
