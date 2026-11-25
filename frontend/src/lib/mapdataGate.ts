// The lazy-only half of mapdata.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the grid-gate status readers. Only lazy surfaces (the plot-type gallery, the analysis center and requirements, the window layout) call them.
// The code moved here verbatim and mapdata.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import type { DataStruct } from "./types";
import { gate, tooSmall } from "./mapdata";

/** True when `canRenderMap(data)` is already its FINAL answer: decided
 *  synchronously (no data, parser-flagged, too small, scattered XYZ) or the
 *  lazy grid gate has classified this DataStruct. False only while the gate
 *  has not run yet -- a "no" from `canRenderMap` then means "not known yet",
 *  and a surface that names availability (the plot-type gallery, the Analysis
 *  Center) must say it is checking rather than call the type unavailable. */
export function mapGateResolved(data: DataStruct | null | undefined): boolean {
  if (!data || data.metadata["is2D"] === true || tooSmall(data) || data.metadata["scatteredXYZ"] === true) return true;
  return gate.has(data);
}

/** Shown while the lazy grid gate is still classifying a dataset. */
export const MAP_GATE_CHECKING = "Checking whether the data forms an X/Y grid…";
