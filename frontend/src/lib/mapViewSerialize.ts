// Save-only half of the durable map-view codec. Workspace serialization is
// loaded on demand, while mapView.ts is needed by the live map/store path;
// keeping this copy logic here avoids charging it to application startup.

import type { MapViewMap, MapViewState } from "./mapView";
import { isDefaultMapView } from "./mapView";

/** True when no dataset's view records a decision. */
export function isDefaultMapViews(m: MapViewMap | undefined | null): boolean {
  if (!m) return true;
  return Object.values(m).every(isDefaultMapView);
}

/** Deep copy for the save path. Default entries record no decision. */
export function serializeMapViews(m: MapViewMap): Record<string, MapViewState> {
  const out: Record<string, MapViewState> = {};
  for (const [id, v] of Object.entries(m)) {
    if (isDefaultMapView(v)) continue;
    out[id] = {
      colormap: v.colormap,
      logZ: v.logZ,
      colorLimits: v.colorLimits ? [v.colorLimits[0], v.colorLimits[1]] : null,
      slices: v.slices.map((s) => ({ ...s, a: { ...s.a }, ...(s.b ? { b: { ...s.b } } : {}) })),
      annotations: v.annotations.map((a) => ({ ...a })),
    };
  }
  return out;
}
