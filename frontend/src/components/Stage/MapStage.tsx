// 2-D map viewer: a Canvas2D heatmap of three scattered channels (x, y, z)
// regridded onto a regular grid (backend /api/plot/map, client fallback). The
// grid is painted to an offscreen nx×ny canvas then blitted scaled — one GPU
// up-scale instead of nx·ny rects. NaN cells (outside the data hull) are
// transparent (gaps), matching uPlot's null = gap for 1-D.

import { useRef, useState } from "react";

import { COLORMAPS } from "../../lib/colormap";
import { lazyRegion } from "../../lib/lazyRegion";
import { cutSpaceForKeys } from "../../lib/mapcuts";
import { mapViewFor } from "../../lib/mapView";
import { useMapGridOpts } from "../../lib/mapGridOpts";
import { hasQSpace, rsmAxisKeys } from "../../lib/mapdataFetch";
import type { Dataset } from "../../lib/types";
import { askAnnotationText } from "../../store/annotationTextDialog";
import { useActiveDataset, useApp } from "../../store/useApp";
import MapRoiOverlay from "./MapRoiOverlay";
import MapSliceOverlay from "./MapSliceOverlay";
import MapToolbar from "./MapToolbar";
import { fmt } from "./mapRender";
import { runMapExport } from "./mapFigureExport";
import { useMapPaint } from "./useMapPaint";
import { useMapCellNative } from "./useMapCellNative";
import { useMapColumnPicks } from "./useMapColumnPicks";
import { useMapPayload } from "./useMapPayload";
import { useDockClearance } from "./useDockClearance";
import { useMapCuts } from "./useMapCuts";
import { useMapContextMenu } from "./useMapContextMenu";
import { useMapPointer } from "./useMapPointer";
import { useMapTools } from "./useMapTools";
import MapInterpolatedBadge from "./MapInterpolatedBadge";
import MapStageNotice from "./MapStageNotice";
import { useRegisterMapExporter } from "./useRegisterMapExporter";
const Map3dStageView = lazyRegion(() => import("./Map3D/Map3dStageView"), "3-D view");

export interface MapStageProps {
  /** Bind the map to an EXPLICIT dataset instead of the Library-active one
   *  (added as item-17 prep by MULTI_PLOT_PLAN item 15; consumed since item
   *  17 by the `kind:"map"` document window —
   *  components/windows/DocumentWindow.tsx). Omitted (the Stage Map tab) =
   *  follow the active dataset, exactly as before. The remaining singleton
   *  reads (gridding/contour settings, theme, RSM peaks) are app-wide by
   *  design — item 17's DOCUMENTED v1 wart: two map windows share them; only
   *  the dataset binding and the local channel picks are per-window. */
  dataset?: Dataset | null;
  /** The map window this body belongs to (absent on the classic Map tab); the figure commands find its export by it. */
  windowId?: string;
}

export default function MapStage({ dataset, windowId }: MapStageProps) {
  const storeActive = useActiveDataset();
  const active = dataset !== undefined ? dataset : storeActive;
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const rsmPeaks = useApp((s) => s.rsmPeaks);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The dock wraps on a narrow stage: keep the map (top tick, colour-bar max) below it.
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const hostTop = useDockClearance(dock);
  // Audit P2.8: the colormap, log/linear colour scale, colour limits, committed
  // slices and annotations are ONE durable record PER DATASET (store/mapView.ts),
  // not local state, so they survive a tab switch, a window close/reopen, a
  // `.dwk` save/reopen, autosave and Pack Project. Reading the entry is a pure
  // lookup (review round 2): this component mounts once per open map, so
  // anything it WROTE on mount would clobber another map's slices and dirty the
  // project. The selector is narrowed to THIS map's entry (round 3, finding 10):
  // `mapViewFor` returns a reference-stable object, so other maps' edits do not
  // re-render this one.
  const dsId = active?.id ?? null;
  const mapView = useApp((s) => mapViewFor(s.mapViews, dsId));
  const setMapColormap = useApp((s) => s.setMapColormap);
  const setMapLogZ = useApp((s) => s.setMapLogZ), setMapView3d = useApp((s) => s.setMapView3d);
  const addMapSlice = useApp((s) => s.addMapSlice), removeMapSlice = useApp((s) => s.removeMapSlice);
  const addMapAnnotation = useApp((s) => s.addMapAnnotation);
  const removeMapAnnotation = useApp((s) => s.removeMapAnnotation);
  const cmap = mapView.colormap;
  const logZ = mapView.logZ;
  // Gridding controls live in the Inspector "2-D map" card (store-backed) so the
  // map toolbar stays focused on view picks (channels / colormap / log).
  const method = useApp((s) => s.mapMethod);
  const gridOpts = useMapGridOpts(); // the card's opt-in Shepard / kriging options
  const res = useApp((s) => s.mapRes);
  const antialias = useApp((s) => s.antialias); // Preferences ▸ Plot ▸ Antialias
  // Contour overlay (Inspector "2-D map" card; ORIGIN_GAP_PLAN #17 remaining half).
  const contourOn = useApp((s) => s.contourOn);
  const contourLevelCount = useApp((s) => s.contourLevelCount);
  const contourScale = useApp((s) => s.contourScale);
  const setContourOn = useApp((s) => s.setContourOn), setStatus = useApp((s) => s.setStatus);
  // x/y/z channel picks over every file column (useMapColumnPicks.ts, #13).
  const { mapActive, keys, setKeys } = useMapColumnPicks(active);
  const cellNative = useMapCellNative(mapActive?.data, keys, mapView.cellLabels !== undefined, mapActive?.id);
  const labels = mapActive?.data.labels ?? [];
  const enoughChannels = labels.length >= 3;
  // Fetch + regrid on dataset/channel changes; `fresh` gates the export.
  const { payload, fresh: payloadFresh, error: mapError } = useMapPayload(mapActive, enoughChannels, keys, method, res, setStatus, gridOpts);

  // RSM (XRDML 2D) datasets carry Qx/Qz columns -> offer an angular⇄Q toggle.
  const axis1Name = String(active?.data.metadata?.axis1_name ?? "Omega");
  const angularKeys = rsmAxisKeys(labels, axis1Name, "angular");
  const qKeys = rsmAxisKeys(labels, axis1Name, "q");
  const qAvailable = hasQSpace(labels) && angularKeys != null && qKeys != null;
  const keysAre = (t: [number, number, number] | null) =>
    t != null && t[0] === keys[0] && t[1] === keys[1] && t[2] === keys[2];

  // Cut tool (H/V/segment cuts + projections -> 1-D datasets). Only meaningful
  // on a 2-D map with the displayed axes on an RSM pair (2θ/ω or Qx/Qz).
  const is2D = active?.data.metadata?.is2D === true;
  const cutSpace = is2D
    ? cutSpaceForKeys(keysAre(angularKeys), qAvailable && keysAre(qKeys))
    : null;
  // Fixed-axis cuts + projections need the regular (frames x pixels) grid;
  // segment cuts interpolate the scattered cloud and work regardless.
  const gridable = Array.isArray(active?.data.metadata?.map_shape);
  const cuts = useMapCuts(active, cutSpace);
  // The drawing tools (Box, cut ruler, sector wedge, Pick) and their routing;
  // see useMapTools.ts. Only the Box also works off an RSM pair.
  const tools = useMapTools(active, mapActive, keys, cutSpace, cuts);
  const { roi, ruler, wedge, pick: pickTool, routed, boxDrawable } = tools;
  // The paint effect and the host box size it keeps in sync live in
  // useMapPaint.ts — see its header (it also returns what THIS instance
  // actually painted, which is what lets its own toolbar stop contradicting
  // its own canvas — review round 7, finding 1). Only the Stage-tab instance
  // (the `dataset` prop omitted; it follows the Library-active dataset, see
  // this component's own header) mirrors that pair into the store's per-
  // dataset `mapPaintedLimits` slot, which is what the Inspector's colour-
  // limit row (bound to the active dataset by rule) reads.
  const { w, h, painted } = useMapPaint({
    hostRef,
    canvasRef,
    payload,
    dsId,
    cmap,
    logZ,
    colorLimits: mapView.colorLimits,
    rsmPeaks,
    // A native grid (image, Igor wave) is drawn as crisp cells, never smoothed.
    antialias: antialias && active?.data.metadata?.map_grid !== "native",
    contour: { on: contourOn, levelCount: contourLevelCount, scale: contourScale },
    cellLabels: mapView.cellLabels,
    cellNative,
    theme,
    accent,
    reportToStore: dataset === undefined,
  });
  const hostSize = { w, h };

  // Every canvas gesture (hover readout, armed-tool dispatch, the H/V click and
  // the segment drag that fire a cut, and P2.8's double-click-to-label) lives
  // in useMapPointer.ts — see its header for why it is not inline here.
  const pointer = useMapPointer({
    payload,
    canvasRef,
    hostRef,
    routed,
    cuts,
    hostSize,
    cutSpace,
    // P2.8: the cut that just ran ALSO leaves a durable slice at the position
    // it was taken, built from the SAME data-space points the request used, so
    // the drawn line and the landed 1-D dataset can never disagree.
    onSlice: (kind, a, b) => {
      if (cutSpace == null) return;
      addMapSlice(dsId, { kind, a, ...(b ? { b } : {}), width: cuts.width, space: cutSpace });
    },
    // `dsId` and `cutSpace` are read from THIS render, i.e. from the moment the
    // double-click happened, and deliberately so: the x/y below are the hit
    // test of that click, expressed in the axes that were on screen then. A
    // label filed against a space or a dataset the user moved to WHILE the
    // modal text dialog was open would be a correct string at a meaningless
    // position. (The dialog is modal, so neither can actually change mid-
    // gesture; the capture is what keeps it true if that ever stops holding.)
    onAnnotate: (x, y) => {
      void askAnnotationText("Map label", "").then((text) => {
        if (text != null && text.trim()) addMapAnnotation(dsId, x, y, text.trim(), cutSpace);
      });
    },
  });
  const { readout, dragPx } = pointer;

  // ⤓: vector (PDF/SVG via /api/export/map-figure) by default, or the canvas PNG.
  const exportMap = () =>
    void runMapExport({
      canvas: canvasRef.current,
      payload,
      loading: !payloadFresh,
      view: {
        cmap, logZ, colorLimits: mapView.colorLimits, contour: { on: contourOn, levelCount: contourLevelCount, scale: contourScale },
        cellLabels: mapView.cellLabels, cellNative,
        marks: { slices: mapView.slices, annotations: mapView.annotations, space: cutSpace }, view3d: mapView.view3d, source: mapActive ? { data: mapActive.data, keys } : undefined,
      },
      stem: active?.name.replace(/\.[^.]+$/, "") ?? "map", setStatus, setView3d: (v) => setMapView3d(dsId, v),
    });

  useRegisterMapExporter(windowId, exportMap);
  // Arming one tool disarms the rest (useMapTools.ts).
  const { setCutMode, toggleRoi, toggleRuler, toggleWedge, togglePick } = tools;
  const ctx = useMapContextMenu({ datasetId: dsId, canvas: canvasRef.current, cmap, logZ, contourOn, hasColorLimits: mapView.colorLimits != null, cutSpace, onExport: exportMap });

  return (
    <div className="qzk-stage" onContextMenu={ctx.onContextMenu}>
      {ctx.node}
      {/* aria-busy: the grid on screen is not yet the one for the current inputs (a gesture now acts on the old one). */}
      <div ref={hostRef} aria-busy={!payloadFresh} data-map-host="" style={{ position: "absolute", inset: 8, top: hostTop }}>
        <canvas
          ref={canvasRef}
          tabIndex={roi.rect || ruler.ruler ? 0 : -1}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            cursor: routed ? routed.cursor : cuts.mode === "off" ? "default" : "crosshair",
          }}
          onPointerMove={pointer.onMove}
          onPointerLeave={(ev) => {
            // A captured drag still belongs to this canvas even when the
            // pointer crosses a floating ROI bar or the canvas edge.  The
            // old mouse-leave path cancelled exactly those valid gestures.
            if (ev.currentTarget.hasPointerCapture?.(ev.pointerId)) return;
            pointer.onLeave();
            roi.onLeave();
            ruler.onLeave();
            wedge.onLeave();
          }}
          onClick={pointer.onClick}
          onDoubleClick={pointer.onDoubleClick}
          onPointerDown={(ev) => {
            if (ev.button !== 0) return;
            ev.currentTarget.setPointerCapture?.(ev.pointerId);
            pointer.onDown(ev);
          }}
          onPointerUp={(ev) => {
            pointer.onUp(ev);
            if (ev.currentTarget.hasPointerCapture?.(ev.pointerId)) ev.currentTarget.releasePointerCapture(ev.pointerId);
          }}
          onPointerCancel={(ev) => {
            if (ev.currentTarget.hasPointerCapture?.(ev.pointerId)) ev.currentTarget.releasePointerCapture(ev.pointerId);
            pointer.onLeave();
            roi.onLeave();
            ruler.onLeave();
            wedge.onLeave();
          }}
          onKeyDown={(ev) => {
            if (!payload) return;
            roi.onKeyDown(ev, payload);
            ruler.onKeyDown(ev, payload);
          }}
        />
        {dragPx && (
          <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width="100%" height="100%">
            <line
              x1={dragPx.a[0]}
              y1={dragPx.a[1]}
              x2={dragPx.b[0]}
              y2={dragPx.b[1]}
              stroke="var(--accent)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
          </svg>
        )}
        {payload && hostSize.w > 0 && hostSize.h > 0 && (
          <MapSliceOverlay
            payload={payload}
            w={hostSize.w}
            h={hostSize.h}
            slices={mapView.slices}
            annotations={mapView.annotations}
            space={cutSpace}
            onRemoveSlice={(id) => removeMapSlice(dsId, id)}
            onRemoveAnnotation={(id) => removeMapAnnotation(dsId, id)}
          />
        )}
        {payload && boxDrawable && hostSize.w > 0 && hostSize.h > 0 && (
          <MapRoiOverlay
            payload={payload}
            w={hostSize.w}
            h={hostSize.h}
            rect={roi.rect}
            preview={roi.preview}
            previewAxis={roi.previewAxis}
            onPreviewAxisChange={roi.setPreviewAxis}
            previewStats={roi.previewStats}
            onIntegrate={roi.commitIntegrate}
            landingBusy={roi.landingBusy}
            onStats={roi.commitStats}
            statsBusy={roi.statsBusy}
            apiStats={roi.apiStats}
            statsError={roi.statsError}
            onClearStats={roi.clearStats}
            onRemove={roi.remove}
            focusAnchor={() => canvasRef.current}
            dragging={roi.dragging}
            boxActive={roi.mode === "roi"}
            rulerState={ruler}
            wedgeState={wedge}
          />
        )}
      </div>

      {active && enoughChannels && (
        <MapToolbar
          datasetId={dsId}
          painted={painted}
          qAvailable={qAvailable}
          isAngular={keysAre(angularKeys)}
          isQ={keysAre(qKeys)}
          onAngular={() => angularKeys && setKeys(angularKeys)}
          onQ={() => qKeys && setKeys(qKeys)}
          labels={labels}
          keys={keys}
          onKeyChange={(slot, v) =>
            setKeys((k) => {
              const next = [...k] as [number, number, number];
              next[slot] = v;
              return next;
            })
          }
          cmap={cmap}
          cmapOptions={Object.keys(COLORMAPS)}
          onCmapChange={(c) => setMapColormap(dsId, c)}
          logZ={logZ}
          onToggleLogZ={() => setMapLogZ(dsId, !logZ)}
          contourOn={contourOn}
          onToggleContour={() => setContourOn(!contourOn)}
          cutSpace={cutSpace}
          gridable={gridable}
          cutMode={cuts.mode}
          onSetCutMode={setCutMode}
          cutWidth={cuts.width}
          onSetCutWidth={cuts.setWidth}
          cutWidthTooltip={
            // Since item 2, Q-space `width` is a physical perpendicular band
            // half-width in Å⁻¹ (mask + bin over the curvilinear cloud);
            // angular keeps the original line-averaging semantics.
            cutSpace === "q"
              ? "Cut width: perpendicular band half-width in Å⁻¹ around the line (0 = nearest points only)"
              : "Cut width: average all lines within ±width/2 (0 = single line)"
          }
          onProjection={cuts.runProjection}
          roiMode={roi.mode}
          onToggleRoi={toggleRoi}
          rulerMode={ruler.mode}
          onToggleRuler={toggleRuler}
          wedgeMode={wedge.mode}
          onToggleWedge={toggleWedge}
          boxDrawable={boxDrawable}
          pickMode={pickTool.mode}
          onTogglePick={togglePick}
          onExport={exportMap}
          dockRef={setDock}
        />
      )}

      {!active && (
        <div className="qzk-ds-meta" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          Select a dataset to map
        </div>
      )}
      {active && !enoughChannels && (
        <MapStageNotice lines={["A 2-D map needs at least 3 channels (x, y, z).", `This dataset has ${labels.length}.`]} />
      )}
      {active && enoughChannels && mapError && (
        <MapStageNotice passThrough lines={["These columns can't be mapped:", mapError, "Choose other x, y and z columns in the toolbar."]} />
      )}

      {mapView.view3d && payload && (
        <Map3dStageView datasetId={dsId} payload={payload} fresh={payloadFresh} view3d={mapView.view3d} cmap={cmap} logZ={logZ} colorLimits={mapView.colorLimits} top={hostTop} data={mapActive?.data} keys={keys} />
      )}
      {payload?.interpolated && <MapInterpolatedBadge nPoints={payload.interpolated.nPoints} />}

      {readout && (
        <div className="qzk-glass qzk-readout">
          {fmt(readout.x)}, {fmt(readout.y)} : {readout.z == null ? "—" : fmt(readout.z)}
        </div>
      )}
    </div>
  );
}

