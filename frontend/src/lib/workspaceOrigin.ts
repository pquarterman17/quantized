// Origin-import figure/fidelity parsing — extracted from lib/workspace.ts
// (LIBRARY_WORKBOOK_UX_PLAN PR A2 size ratchet) to fund the new v4 `workbooks[]`
// wiring: this section was already fully self-contained (both `parseOriginFigures`
// and `parseOriginFidelity`, plus the small `stringsIn` helper they and the rest
// of `parseWorkspace` share, are called only from lib/workspace.ts — verified by
// grep, no other module references them), making it the natural next block to
// move, same rationale as workspaceMerge.ts's own extraction note. `stringsIn`
// moved too (rather than staying behind and being imported back) so this module
// has no dependency on lib/workspace.ts in either direction — workspace.ts
// depends on this module, never the reverse.

import type { OriginFidelityEntry } from "./originFidelity";
import type { OriginFigureEntry } from "./originFigures";
import type { OriginFidelityManifest } from "./types";

/** Every string in `v` that is both a string and a member of `valid` — the
 *  shared "clamp a persisted id list to what actually survived load" helper
 *  used for dataset/folder id references throughout `parseWorkspace`. */
export function stringsIn(v: unknown, valid: Set<string>): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && valid.has(x)) : [];
}

/** Validate the persisted Origin-import figures, dropping malformed entries and
 *  clamping dataset references to ids that survived load — so a restored figure
 *  can never dangle onto a pruned dataset. `figure` is opaque decoded Origin
 *  data (an `OriginFigure`); it is passed through structurally rather than
 *  deep-validated, mirroring how `data` (a DataStruct) is the only structurally
 *  checked payload. */
export function parseOriginFigures(v: unknown, dsIds: Set<string>): OriginFigureEntry[] {
  if (!Array.isArray(v)) return [];
  const out: OriginFigureEntry[] = [];
  for (const f of v) {
    if (typeof f !== "object" || f === null) continue;
    const o = f as Record<string, unknown>;
    if (
      typeof o.id !== "string" ||
      typeof o.stem !== "string" ||
      typeof o.figure !== "object" ||
      o.figure === null ||
      !(o.datasetId === null || typeof o.datasetId === "string")
    ) {
      continue;
    }
    const datasetId =
      typeof o.datasetId === "string" && dsIds.has(o.datasetId) ? o.datasetId : null;
    const siblingIds = Array.isArray(o.siblingIds)
      ? o.siblingIds.filter((x): x is string => typeof x === "string" && dsIds.has(x))
      : [];
    out.push({
      id: o.id,
      stem: o.stem,
      figure: o.figure as OriginFigureEntry["figure"],
      datasetId,
      siblingIds,
    });
  }
  return out;
}

function isOriginFidelityManifest(v: unknown): v is OriginFidelityManifest {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.version === 1 &&
    (o.container === "opj" || o.container === "opju") &&
    ["exact", "best_effort", "reference_only", "unresolved"].includes(String(o.status)) &&
    Number.isInteger(o.graph_records_total) && Number(o.graph_records_total) >= 0 &&
    Number.isInteger(o.graph_records_actionable) && Number(o.graph_records_actionable) >= 0 &&
    Number.isInteger(o.graph_records_filtered) && Number(o.graph_records_filtered) >= 0 &&
    Array.isArray(o.omissions) &&
    o.omissions.every((x) => typeof x === "string") &&
    Array.isArray(o.filtered_figures) &&
    o.filtered_figures.every((f) => {
      if (typeof f !== "object" || f === null) return false;
      const item = f as Record<string, unknown>;
      return (
        Number.isInteger(item.index) &&
        typeof item.name === "string" &&
        (item.layer === null || Number.isInteger(item.layer)) &&
        typeof item.reason === "string"
      );
    })
  );
}

export function parseOriginFidelity(v: unknown, dsIds: Set<string>): OriginFidelityEntry[] {
  if (!Array.isArray(v)) return [];
  const out: OriginFidelityEntry[] = [];
  for (const item of v) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.stem !== "string") continue;
    if (!isOriginFidelityManifest(o.manifest)) continue;
    const siblingIds = stringsIn(o.siblingIds, dsIds);
    if (siblingIds.length === 0) continue;
    out.push({ id: o.id, stem: o.stem, siblingIds, manifest: o.manifest });
  }
  return out;
}
