// The one writer of a map's scale bar (`MapViewState.scaleBar`, lib/mapScaleBar.ts):
// one undo step per change, nothing recorded when nothing changed. It lives apart
// from the map-view slice (store/mapView.ts) so the scale bar's fields and this
// writer load with the Inspector card that edits it, not at startup.
import type { MapScaleBar } from "../lib/mapScaleBarOptions";
import { mapViewFor } from "../lib/mapView";
import { useApp } from "./useApp";

/** Set (or, with undefined, remove) the scale bar of `datasetId`'s map. */
export function setMapScaleBar(datasetId: string | null, scaleBar: MapScaleBar | undefined): void {
  if (!datasetId) return;
  const s = useApp.getState();
  if (JSON.stringify(mapViewFor(s.mapViews, datasetId).scaleBar) === JSON.stringify(scaleBar)) return;
  const name = s.datasets.find((d) => d.id === datasetId)?.name;
  s.recordHistory(name ? `change map scale bar "${name}"` : "change map scale bar");
  useApp.setState((st) => ({ mapViews: { ...st.mapViews, [datasetId]: { ...mapViewFor(st.mapViews, datasetId), scaleBar } } }));
}
