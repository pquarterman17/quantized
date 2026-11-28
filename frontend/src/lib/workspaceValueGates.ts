// Value-level gates for `workspaceForwardCompat.ts`: features carried by a VALUE
// of a field an older release already reads (a new `kind`, an option inside
// `view3d.ext`, a non-default axis base, an overlay sub-option). The per-field
// classification there cannot see them, so the walker asks here. Split out of
// workspaceForwardCompat.ts to keep it under the 500-line `.ts` ceiling.

import { isMeasureKind } from "./shapeMeasureFields";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// Which kind reads which `Map3dView.ext` keys (`Stage/map3dExt.ts`, `map3dScatter.ts`). Surface and waterfall read none.
const EXT_OWNER: readonly (readonly [string, RegExp])[] = [["bars3d", /^bar/], ["vectors3d", /^vec/], ["scatter3d", /^(sc|wall)/]];

/** Overlay options added by item 24 (centroid, hull, the mean ellipse): `PlotView.overlays` / `overrides.overlays`. */
export const groupShapesOn = (o: Obj): boolean => !!o.centroid || !!o.hull || (isObj(o.ellipse) && o.ellipse.kind === "mean");

/** A saved result that records the row range its tool read (OG20, `lib/inputRowRange.ts`):
 *  `analysisResults[].parameters.rowRange`. MEASURED by reading v0.45.0's `analysisResult.ts`: its `parameters`
 *  sanitizer keeps any nested JSON, so the key is not dropped, but v0.45.0 would show the result with no sign of
 *  the window and save it under the unranged duplicate key. The owner chose a gated key, so it is v9. The nested
 *  `rangeId` (the named range it read, lib/namedRangeResultFreshness.ts) needs no rung of its own: it only exists under
 *  this key, and under `INPUT_ROW_RANGE_KEY` (a gated metadata key), so no file a release below v9 reads can hold one. */
export const RESULT_ROW_RANGE = "AnalysisResult.parameters.rowRange";

export function checkResultRange(result: unknown, found: Set<string>): void {
  if (isObj(result) && isObj(result.parameters) && isObj(result.parameters.rowRange)) found.add(RESULT_ROW_RANGE);
}

/** A saved ROI of kind "polygon" (the map's Polygon tool): `savedRois[].kind`. MEASURED by reading v0.34.0's and
 *  v0.45.0's `store/roisCodec.ts`: `deserializeRois` accepts only rect / ruler / sector and skips any other kind with a
 *  warning, so the next save would drop the polygon. Gated at v9 (NEW_SINCE_V045). */
export const SAVED_ROI_POLYGON = "RoiDef.kind=polygon";

export function checkSavedRois(list: unknown, found: Set<string>): void {
  for (const r of Array.isArray(list) ? list : []) if (isObj(r) && r.kind === "polygon") found.add(SAVED_ROI_POLYGON);
}

/** Add to `found` the value-level gated features of `o`, an object of `type`. */
export function checkValueGates(o: Obj, type: string, found: Set<string>): void {
  if ((type === "MapViewState" || type === "RecipeMapView") && isObj(o.view3d)) {
    // The bar / vector options and kinds: v0.45.0 reads `view3d` but drops `ext` and, for an unknown kind, the whole view.
    // Only options the CURRENT kind reads need the rung: other kinds' leftovers ride along inertly (see EXT_OWNER).
    const { ext, kind } = o.view3d;
    if (isObj(ext) && Object.keys(ext).some((k) => EXT_OWNER.find(([, re]) => re.test(k))?.[0] === kind || !EXT_OWNER.some(([, re]) => re.test(k)))) found.add("Map3dView.ext");
    if (o.view3d.kind === "bars3d" || o.view3d.kind === "vectors3d") found.add("Map3dView.kind=bars_vectors");
  }
  if (type === "AxisFormat" && o.base !== undefined && o.base !== "e") found.add("AxisFormat.base=2");
  // A slope / distance / angle / scale-bar shape: 0.34 drops the whole shape.
  if ((type === "Shape" || type === "OverrideShape") && typeof o.kind === "string" && isMeasureKind(o.kind)) found.add(`${type}.kind=measure`);
}
