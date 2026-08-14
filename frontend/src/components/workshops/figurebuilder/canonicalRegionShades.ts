// Pure region-shade canonical-draft helpers (F2.3j, owner decision
// 2026-08-13: decoded film-stack shades are EDITABLE plot objects, not
// immutable provenance). Derive a display row per shade and add/patch/remove
// one shade by id in the draft's `regionShades` array. No React/store import
// -- unit-testable standalone, same shape as canonicalRefLines.ts/
// canonicalShapes.ts.
//
// `regionShades` is a `PlotView` field (`decor.regionShades`, see
// lib/figureContract.ts) with NO `FigureOverrides` equivalent -- the same
// F2.3b/c/d situation -- so the hook writes it straight through
// `setCanonicalView`, not the publication-overrides delta bridge.
//
// Rows number FLAT by draw order ("Region shade 1", "Region shade 2", …),
// unlike `canonicalRefLines.ts`'s axis-scoped numbering: a reference line's
// axis is fixed for its whole life (a stable grouping key), but a shade's
// axis is EDITABLE here (see RegionShadesCard.tsx's doc for why) -- scoping
// the label by a field the user can flip out from under it would renumber
// every sibling shade on an unrelated edit.

import type { FigureViewState } from "../../../lib/figureDocument";
import type { RegionShade } from "../../../lib/types";

export interface RegionShadeRow {
  id: string;
  /** 1-based, draw-order ACCESSIBLE label ("Region shade 1", "Region shade 2"). */
  label: string;
  /** What the row actually SHOWS ("Shade 1") -- same visible-vs-accessible
   *  split as `RefLineRow.short`. */
  short: string;
}

/** One row per shade, in the draft's own array order (region shades have no
 *  separate display-order field, same as reference lines). */
export function deriveRegionShadeRows(shades: readonly RegionShade[]): RegionShadeRow[] {
  return shades.map((shade, i) => ({
    id: shade.id,
    label: `Region shade ${i + 1}`,
    short: `Shade ${i + 1}`,
  }));
}

/** Merge `patch` into the one shade matching `id`; every other shade is
 *  returned unchanged (by reference). A no-op array for an unknown id --
 *  callers don't special-case a missing shade. */
export function patchRegionShadeList(
  shades: readonly RegionShade[],
  id: string,
  patch: Partial<Omit<RegionShade, "id">>,
): RegionShade[] {
  return shades.map((shade) => (shade.id === id ? { ...shade, ...patch } : shade));
}

/** Drop the one shade matching `id`. No-op (same-length array) for an
 *  unknown id. */
export function removeRegionShadeFromList(shades: readonly RegionShade[], id: string): RegionShade[] {
  return shades.filter((shade) => shade.id !== id);
}

/** Id prefix for shades created inside a Publication Preview draft --
 *  deliberately NOT the store's `shade-` prefix, same collision-avoidance
 *  reasoning as `canonicalRefLines.ts`'s `appendRefLine`/`DRAFT_PREFIX`. */
const DRAFT_PREFIX = "pshade-";

/** Append a shade with a draft-namespaced id one past the highest existing
 *  draft id. Rejects a shade with any non-finite coordinate (returns the
 *  list unchanged) -- the same shape `viewOverrides` (figureSpec.ts) filters
 *  out of the render request, so an accepted-but-unrenderable shade can
 *  never reach the draft. */
export function appendRegionShade(
  shades: readonly RegionShade[],
  shade: Omit<RegionShade, "id">,
): RegionShade[] {
  if (![shade.x1, shade.y1, shade.x2, shade.y2].every(Number.isFinite)) return [...shades];
  const highest = shades.reduce((best, s) => {
    if (!s.id.startsWith(DRAFT_PREFIX)) return best;
    const suffix = Number(s.id.slice(DRAFT_PREFIX.length));
    return Number.isInteger(suffix) && suffix > best ? suffix : best;
  }, 0);
  return [...shades, { id: `${DRAFT_PREFIX}${highest + 1}`, ...shade }];
}

/** Bundle the three edit callbacks useFigureBuilder.ts spreads into its
 *  return value, so that hook's own per-field wiring costs it one call
 *  instead of the three separate consts F2.3d's refLines inline directly --
 *  useFigureBuilder.ts sits close to its general size ceiling, so this
 *  feature's glue lives beside the pure ops it wires instead of repeating
 *  their call shape inline (the ONLY difference from F2.3d's inline shape;
 *  the resulting callbacks behave identically). */
export function regionShadeBindings(
  regionShades: readonly RegionShade[],
  setCanonicalView: (patch: Partial<FigureViewState>) => void,
) {
  return {
    regionShades,
    patchRegionShade: (id: string, patch: Partial<Omit<RegionShade, "id">>) =>
      setCanonicalView({ regionShades: patchRegionShadeList(regionShades, id, patch) }),
    addRegionShade: (shade: Omit<RegionShade, "id">) =>
      setCanonicalView({ regionShades: appendRegionShade(regionShades, shade) }),
    removeRegionShade: (id: string) =>
      setCanonicalView({ regionShades: removeRegionShadeFromList(regionShades, id) }),
  };
}
