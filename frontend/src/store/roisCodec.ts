// `.dwk` persistence for `savedRois` (RSM_CUTS_PLAN item 13), split out of
// `store/rois.ts` (bundle diet slice 20, plans/BUNDLE_HEADROOM.md): only the
// workspace codec calls these, and the slice itself is eager. lib/workspace.ts
// and lib/workspaceSerialize.ts are this module's only callers; they never
// touch RoiDef's shape themselves, mirroring how lib/plotspec.ts owns
// `sanitizeSavedPlotSpecs` for `savedPlotSpecs`. Import from this path, never
// re-exported through rois.ts (slice 18).

import type { CutSpace } from "../lib/mapcuts";
import type { RoiDef, RoiRect, RoiRuler, RoiSector } from "../lib/roi";

/** Serialize `savedRois` for the .dwk doc. A defensive shallow copy — RoiDef
 *  is already plain JSON-safe data (no dataset references, no undefined-vs-
 *  absent optionals to trim, unlike Dataset's own serialize in workspace.ts). */
export function serializeRois(rois: RoiDef[]): RoiDef[] {
  return rois.map((r) => ({ ...r }));
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isCutSpace(v: unknown): v is CutSpace {
  return v === "angular" || v === "q";
}

function isRoiRectShape(v: unknown): v is RoiRect {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isCutSpace(o.space) &&
    isFiniteNumber(o.x0) &&
    isFiniteNumber(o.x1) &&
    isFiniteNumber(o.y0) &&
    isFiniteNumber(o.y1)
  );
}

function isRoiRulerShape(v: unknown): v is RoiRuler {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isCutSpace(o.space) &&
    isFiniteNumber(o.cx) &&
    isFiniteNumber(o.cy) &&
    isFiniteNumber(o.angle) &&
    isFiniteNumber(o.length) &&
    isFiniteNumber(o.width)
  );
}

function isRoiSectorShape(v: unknown): v is RoiSector {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isFiniteNumber(o.qMin) &&
    isFiniteNumber(o.qMax) &&
    isFiniteNumber(o.phiMin) &&
    isFiniteNumber(o.phiMax)
  );
}

/** Validate persisted `savedRois` entries from a .dwk. A hand-edited or
 *  otherwise malformed entry is skipped (named in `warnings`, lib/workspace.ts's
 *  `migrationWarnings`) rather than throwing or poisoning the rest of the
 *  list — mirrors lib/plotspec.sanitizeSavedPlotSpecs' shape. Absent/non-array
 *  input (a pre-item-13 .dwk) degrades to an empty list, no warning. */
export function deserializeRois(v: unknown, warnings: string[]): RoiDef[] {
  if (!Array.isArray(v)) return [];
  const out: RoiDef[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string") continue;
    if (o.kind === "rect" && isRoiRectShape(o.rect)) {
      out.push({ id: o.id, name: o.name, kind: "rect", rect: o.rect });
    } else if (o.kind === "ruler" && isRoiRulerShape(o.ruler)) {
      out.push({ id: o.id, name: o.name, kind: "ruler", ruler: o.ruler });
    } else if (o.kind === "sector" && isRoiSectorShape(o.sector)) {
      out.push({ id: o.id, name: o.name, kind: "sector", sector: o.sector });
    } else {
      warnings.push(`skipped saved ROI "${o.name}" with an invalid or unknown shape`);
    }
  }
  return out;
}
