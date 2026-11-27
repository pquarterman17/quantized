// The Map stage's 3-D view (lazy; mounted only while a 3-D view is chosen):
// the INTERACTIVE canvas by default (`Map3dCanvas`), or the server's static
// render of the export ("Export preview", `Map3dPreview`).
//
// SCREEN == EXPORT (gap audit 5, item 3e): the canvas draws the scene built
// from the export's own request (`mapFigureBody` + `view3dOptions`, as the
// static preview and ⤓ send it), and every settled rotation / zoom is ONE
// undoable `setMapView3d` write of elev / azim / zoom into the durable map
// view -- the record ⤓ and the export dialog read. So the export is drawn
// from the angles on screen; `map3dViewFixture.test.ts` pins that, and the
// backend half checks matplotlib's camera against the same fixture.

import { useEffect, useMemo, useState } from "react";

import type { ColormapName } from "../../../lib/colormap";
import { lazyRegion } from "../../../lib/lazyRegion";
import type { MapPayload } from "../../../lib/mapdataFetch";
import { DEFAULT_MAP3D, type Map3dView } from "../../../lib/mapView3d";
import type { View3d } from "../../../lib/project3d";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { view3dCaption } from "../map3dCaption";
import { DOCK_INSET } from "../map3dDockFit";
import { refusalFixedInPanel } from "../map3dPanelRefusals";
import { map3dPanelSettled, openMap3dPanelFor } from "../useMap3dPanelOpen";
import { mapFigureBody } from "../mapFigureExport";
import { MAP3D_LABELS, view3dOptions } from "../map3dRequest";
import Map3dCanvas from "./Map3dCanvas";
import { extCaption } from "./renderExt3d";
import { sceneFromBody } from "./scene3d";

const Map3dPreview = lazyRegion(() => import("../Map3dPreview"), "3-D export preview");

export interface Map3dStageViewProps {
  datasetId: string | null;
  payload: MapPayload | null;
  fresh: boolean;
  view3d: Map3dView;
  cmap: ColormapName;
  logZ: boolean;
  colorLimits: readonly [number | null, number | null] | null;
  top: number;
  data: DataStruct | undefined;
  keys: readonly [number, number, number];
  /** The 3-D panel is docked beside the scene: leave its strip free (`map3dDockFit.ts`). */
  docked?: boolean;
}

const HOME: View3d = { elev: DEFAULT_MAP3D.elev, azim: DEFAULT_MAP3D.azim, zoom: DEFAULT_MAP3D.zoom };
const ROW = { display: "flex", alignItems: "center", gap: 6, fontSize: 11 } as const;

/** The stored view with the settled camera written in (what one gesture commits). */
export function withCamera(v3: Map3dView, cam: View3d): Map3dView {
  return { ...v3, elev: cam.elev, azim: cam.azim, zoom: cam.zoom };
}

export default function Map3dStageView(props: Map3dStageViewProps) {
  const { datasetId, payload, fresh, view3d, cmap, logZ, colorLimits, top, data, keys, docked } = props;
  const setView3d = useApp((s) => s.setMapView3d);
  const [mode, setMode] = useState<"interactive" | "static">("interactive");
  const view = useMemo(
    () => ({ cmap, logZ, colorLimits, contour: { on: false, levelCount: 0, scale: "linear" as const }, view3d, ...(data ? { source: { data, keys } } : {}) }),
    [cmap, logZ, colorLimits, view3d, data, keys],
  );
  // The scene does not depend on the camera: a rotation re-projects, it does
  // not rebuild (or re-sample) the data.
  const { elev: _e, azim: _a, zoom: _z, ...shape } = view3d;
  const shapeKey = JSON.stringify(shape);
  const scene = useMemo(
    () => (payload && fresh ? sceneFromBody(mapFigureBody(payload, view, view3dOptions(view3d, "png", "preview"))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the camera is deliberately not an input
    [payload, fresh, cmap, logZ, colorLimits, data, keys, shapeKey],
  );
  // A refusal the panel can fix opens it (once per refusal: closing it keeps it closed); a drawn scene re-arms that.
  useEffect(() => {
    if (!scene) return;
    if (!("error" in scene)) map3dPanelSettled();
    else if (refusalFixedInPanel(scene.error)) openMap3dPanelFor(scene.error);
  }, [scene]);
  const cam = useMemo<View3d>(() => ({ elev: view3d.elev, azim: view3d.azim, zoom: view3d.zoom }), [view3d.elev, view3d.azim, view3d.zoom]);
  const ok = scene && !("error" in scene) ? scene : null;
  const extNote = ok && (ok.kind === "bars" || ok.kind === "vectors") ? extCaption(ok) : ok?.kind === "points" ? ok.extras?.note ?? "" : "";
  const caption = extNote || (payload && fresh ? view3dCaption(payload, view) : "");

  const modeSelect = (
    <label style={ROW}>
      Show
      <select className="qz-select" aria-label="3-D view mode" value={mode} onChange={(e) => setMode(e.target.value as "interactive" | "static")}>
        <option value="interactive">Interactive</option>
        <option value="static">Export preview</option>
      </select>
    </label>
  );
  const dropLines = view3d.kind === "scatter3d" && (
    <label style={ROW}>
      <input type="checkbox" checked={view3d.dropLines} onChange={(e) => setView3d(datasetId, { ...view3d, dropLines: e.target.checked })} />
      Drop lines
    </label>
  );

  return (
    <div data-map3d-view="" style={{ position: "absolute", inset: 8, top, ...(docked ? { right: 8 + DOCK_INSET } : {}), zIndex: 2, background: "var(--surface-1)", overflow: "hidden" }}>
      {mode === "static" ? (
        <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateRows: "auto 1fr" }}>
          <div style={{ ...ROW, padding: "4px 8px", gap: 8 }}>{modeSelect}{dropLines}</div>
          <div style={{ position: "relative" }}>
            <Map3dPreview payload={payload} fresh={fresh} view3d={view3d} cmap={cmap} logZ={logZ} colorLimits={colorLimits} top={0} data={data} keys={keys} />
          </div>
        </div>
      ) : !scene || "error" in scene ? (
        // The mode switch stays reachable: the server render may still draw it.
        <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateRows: "auto 1fr" }}>
          <div style={{ ...ROW, padding: "4px 8px", gap: 8 }}>{modeSelect}</div>
          {!scene ? (
            <div role="status" className="qzk-helptext" style={{ display: "grid", placeItems: "center" }}>
              Building 3-D view…
            </div>
          ) : (
            <div role="alert" className="qzk-helptext" style={{ display: "grid", placeItems: "center", color: "var(--danger)" }}>
              3-D view not drawn — {scene.error}
            </div>
          )}
        </div>
      ) : (
        <Map3dCanvas
          key={datasetId ?? ""}
          scene={scene}
          view={cam}
          home={HOME}
          label={`${MAP3D_LABELS[view3d.kind]} of ${payload?.zLabel || "z"}`}
          onCommit={(c) => setView3d(datasetId, withCamera(view3d, c))}
        >
          {modeSelect}
          {dropLines}
        </Map3dCanvas>
      )}
      {mode === "interactive" && caption && (
        <div className="qzk-helptext" data-map3d-caption="" style={{ position: "absolute", left: 8, bottom: 4, pointerEvents: "none" }}>
          {caption}
        </div>
      )}
    </div>
  );
}
