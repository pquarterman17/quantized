// Map/RSM capability checks — the two predicates needed EAGERLY at import
// time to route/gate the Map tab (lib/quickPlot.ts, lib/plotSelectedTogether.ts,
// lib/stagetab.ts, components/Stage/Stage.tsx).
//
// SCOPE (narrowed 2026-08-23, C2 bundle pass): the actual heatmap-grid
// fetch/regrid + RSM axis-key helpers (`fetchMap`/`buildMapColumns`/
// `regridNearest`/`hasQSpace`/`rsmAxisKeys`/`MapPayload`) now live in
// `lib/mapdataFetch.ts`, reached only from `MapStage` and its ROI/sector-wedge
// helpers — all already behind `MapStage`'s own `lazy()` boundary, never the
// eager tab-routing path. See that file's own header for the
// verified-no-eager-consumer rationale.

import type { DataStruct } from "./types";

/** True when a dataset is a 2-D map (e.g. an XRDML reciprocal-space map): the
 *  parser flagged `metadata.is2D` and it carries the ≥3 channels the map needs
 *  (two axes + intensity). Drives import-time stage routing to the Map tab. */
export function is2DMap(ds: DataStruct): boolean {
  return ds.metadata["is2D"] === true && ds.labels.length >= 3;
}

/** Can this dataset produce a 2-D map at all? (owner request 2026-07-25)
 *
 *  A map needs three channels — x, y and the z it colours by — so a dataset
 *  with fewer cannot make one. Defined ONCE here because two consumers now ask:
 *  `MapStage` (to decide between the canvas and its "needs 3 channels" notice)
 *  and `Stage` (to decide whether the Map TAB exists at all). Two copies of the
 *  rule would eventually disagree, and the visible symptom would be a tab that
 *  opens onto a permanent apology.
 *
 *  Deliberately capability, not history: "has a map been drawn" would be
 *  circular — you could never reach the tab to draw the first one. */
export function canRenderMap(data: DataStruct | null | undefined): boolean {
  return (data?.labels.length ?? 0) >= 3;
}
