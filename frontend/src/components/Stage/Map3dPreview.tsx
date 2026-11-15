// The Map stage's static 3-D view: the server's matplotlib render of the
// surface / 3-D scatter / 3-D waterfall, shown over the 2-D canvas. Lazy (only
// mounted while a 3-D view is chosen). Static by design -- an interactive
// rotating view is a later lane and needs no dependency here.
//
// The picture is `POST /api/export/map-figure` with the EXPORT's own body
// (`mapFigureBody` + `view3dOptions`) and only `fmt: "png"`, so ⤓ exports
// exactly this. The body carries every input the picture depends on, so its
// JSON is the refetch key; a server refusal (too few points, a waterfall of one
// curve, …) is shown as the reason instead of a stale picture.

import { useMemo } from "react";

import type { ColormapName } from "../../lib/colormap";
import type { MapPayload } from "../../lib/mapdataFetch";
import type { DataStruct } from "../../lib/types";
import type { Map3dView } from "../../lib/mapView3d";
import { mapFigureBody } from "./mapFigureExport";
import { view3dCaption, view3dOptions } from "./map3dRequest";
import { useMap3dImage } from "./useMap3dImage";

export interface Map3dPreviewProps {
  payload: MapPayload | null;
  /** The grid on screen is the one for the current inputs (see MapStage). */
  fresh: boolean;
  view3d: Map3dView;
  cmap: ColormapName;
  logZ: boolean;
  colorLimits: readonly [number | null, number | null] | null;
  /** Top inset (px): clears the toolbar dock, as the 2-D canvas host does. */
  top: number;
  /** The map's columns and picks (see `MapExportView.source`). */
  data: DataStruct | undefined;
  keys: readonly [number, number, number];
}

export default function Map3dPreview({ payload, fresh, view3d, cmap, logZ, colorLimits, top, data, keys }: Map3dPreviewProps) {
  const view = useMemo(
    () => ({ cmap, logZ, colorLimits, contour: { on: false, levelCount: 0, scale: "linear" as const }, view3d, ...(data ? { source: { data, keys } } : {}) }),
    [cmap, logZ, colorLimits, view3d, data, keys],
  );
  const body = useMemo(
    () => (payload && fresh ? mapFigureBody(payload, view, view3dOptions(view3d, "png", "preview")) : null),
    [payload, fresh, view, view3d],
  );
  const caption = payload ? view3dCaption(payload, view) : "";
  const shot = useMap3dImage(body);

  return (
    <div
      data-map3d-preview=""
      aria-busy={!shot}
      style={{ position: "absolute", inset: 8, top, zIndex: 2, display: "grid", placeItems: "center", background: "var(--surface-1)", overflow: "hidden" }}
    >
      {shot && "url" in shot ? (
        <img alt="3-D map preview" src={shot.url} style={{ maxWidth: "100%", maxHeight: "calc(100% - 22px)", objectFit: "contain" }} />
      ) : (
        <div role={shot ? "alert" : "status"} className="qzk-ds-meta qzk-msg" style={{ padding: 16, maxWidth: 420, textAlign: "center", color: shot ? "var(--danger)" : "var(--text-dim)" }}>
          {shot ? `3-D view not drawn — ${shot.error}` : "Rendering 3-D view…"}
        </div>
      )}
      {caption && (
        <div data-map3d-caption="" style={{ position: "absolute", left: 0, right: 0, bottom: 2, textAlign: "center", fontSize: 11, color: "var(--text-dim)" }}>
          {caption}
        </div>
      )}
    </div>
  );
}
