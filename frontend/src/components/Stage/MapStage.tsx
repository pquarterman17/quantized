// 2-D map viewer: a Canvas2D heatmap of three scattered channels (x, y, z)
// regridded onto a regular grid (backend /api/plot/map, client fallback). The
// grid is painted to an offscreen nx×ny canvas then blitted scaled — one GPU
// up-scale instead of nx·ny rects. NaN cells (outside the data hull) are
// transparent (gaps), matching uPlot's null = gap for 1-D.

import { useEffect, useRef, useState } from "react";

import { COLORMAPS } from "../../lib/colormap";
import { cutSpaceForKeys } from "../../lib/mapcuts";
import { mapViewFor } from "../../lib/mapView";
import { fetchMap, hasQSpace, rsmAxisKeys, type MapPayload } from "../../lib/mapdataFetch";
import { exportCanvasPng } from "../../lib/plotExport";
import type { Dataset } from "../../lib/types";
import { askAnnotationText } from "../../store/annotationTextDialog";
import { useActiveDataset, useApp } from "../../store/useApp";
import MapRoiOverlay from "./MapRoiOverlay";
import MapSliceOverlay from "./MapSliceOverlay";
import MapToolbar from "./MapToolbar";
import { armExclusively, routedTool } from "./mapToolArming";
import { fmt } from "./mapRender";
import { useMapPaint } from "./useMapPaint";
import { useMapCuts } from "./useMapCuts";
import { useMapPointer } from "./useMapPointer";
import { useMapRoi } from "./useMapRoi";
import { useMapRuler } from "./useMapRuler";
import { useMapSectorWedge } from "./useMapSectorWedge";

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
}

export default function MapStage({ dataset }: MapStageProps) {
  const storeActive = useActiveDataset();
  const active = dataset !== undefined ? dataset : storeActive;
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const rsmPeaks = useApp((s) => s.rsmPeaks);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [payload, setPayload] = useState<MapPayload | null>(null);
  // Audit P2.8: the colormap, the linear/log colour scale, the explicit colour
  // limits, the committed H/V/segment slices and the map annotations are ONE
  // durable record PER DATASET in the store (store/mapView.ts) instead of this
  // component's local `useState`. That is what makes them survive an unmount —
  // switching the Stage tab, or closing and reopening a map document window —
  // as well as a `.dwk` save/reopen, autosave and Pack Project. Reading the
  // entry is a pure lookup (review round 2): this component is mounted once
  // per open map, so anything it WROTE on mount would be a second map
  // destroying the first one's slices, and merely opening a map would dirty
  // the project.
  // The selector is narrowed to THIS map's own entry (P2.8 review round 3,
  // finding 10): `mapViewFor` returns either the stored object or the frozen
  // `DEFAULT_MAP_VIEW`, both reference-stable, so subscribing to the whole
  // `mapViews` record only meant every open map re-rendered on any OTHER
  // dataset's map edit.
  const dsId = active?.id ?? null;
  const mapView = useApp((s) => mapViewFor(s.mapViews, dsId));
  const setMapColormap = useApp((s) => s.setMapColormap);
  const setMapLogZ = useApp((s) => s.setMapLogZ);
  const addMapSlice = useApp((s) => s.addMapSlice);
  const removeMapSlice = useApp((s) => s.removeMapSlice);
  const addMapAnnotation = useApp((s) => s.addMapAnnotation);
  const removeMapAnnotation = useApp((s) => s.removeMapAnnotation);
  const cmap = mapView.colormap;
  const logZ = mapView.logZ;
  // Gridding controls live in the Inspector "2-D map" card (store-backed) so the
  // map toolbar stays focused on view picks (channels / colormap / log).
  const method = useApp((s) => s.mapMethod);
  const res = useApp((s) => s.mapRes);
  const antialias = useApp((s) => s.antialias); // Preferences ▸ Plot ▸ Antialias
  // Contour overlay (Inspector "2-D map" card; ORIGIN_GAP_PLAN #17 remaining half).
  const contourOn = useApp((s) => s.contourOn);
  const contourLevelCount = useApp((s) => s.contourLevelCount);
  const contourScale = useApp((s) => s.contourScale);
  const setContourOn = useApp((s) => s.setContourOn);
  const setStatus = useApp((s) => s.setStatus);
  // x/y/z channel picks, local to this view (default the first three channels).
  const [keys, setKeys] = useState<[number, number, number]>([0, 1, 2]);

  const labels = active?.data.labels ?? [];
  const enoughChannels = labels.length >= 3;

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
  // Box ROI: draw/move/resize + live preview + inline commit (RSM_CUTS_PLAN
  // item 6) — the SAME cutSpace-gated tool group as H/V/seg, mutually
  // exclusive with them (arming one disarms the other; see setCutMode/
  // toggleRoi below) since both drive the same canvas pointer gestures.
  const roi = useMapRoi(active, cutSpace);
  // Cut ruler: radial/transverse-about-a-peak + free-hand draw/move/resize
  // (RSM_CUTS_PLAN item 7) — same cutSpace-gated group, mutually exclusive
  // with both the box and H/V/seg (see toggleRoi/toggleRuler/setCutMode).
  const ruler = useMapRuler(active, cutSpace);
  // Sector wedge: drag the qMin/qMax/phiMin/phiMax handles or rotate from
  // the interior (RSM_CUTS_PLAN item 12) — same cutSpace-gated group,
  // mutually exclusive with box/ruler/H/V/seg; Q-space only (its own `mode`
  // arms regardless, but `wedge.sector`/dragging both go inert off a Q
  // view — see useMapSectorWedge.ts's header).
  const wedge = useMapSectorWedge(active, cutSpace);
  // The paint effect and the host box size it keeps in sync live in
  // useMapPaint.ts — see its header (it also reports what the paint actually
  // used as its colour range, which is what lets the Inspector stop
  // contradicting the canvas).
  const hostSize = useMapPaint({
    hostRef,
    canvasRef,
    payload,
    dsId,
    cmap,
    logZ,
    colorLimits: mapView.colorLimits,
    rsmPeaks,
    antialias,
    contour: { on: contourOn, levelCount: contourLevelCount, scale: contourScale },
    theme,
    accent,
  });

  // Reset the channel picks to 0/1/2 when the active dataset changes.
  useEffect(() => {
    setKeys([0, 1, Math.min(2, Math.max(0, labels.length - 1))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // Fetch + regrid on dataset/channel changes. AbortController (item 16)
  // cancels a SUPERSEDED request outright instead of only discarding its
  // result, so the 2θ/ω ⇄ Q toggle stops racing itself; an abort never
  // triggers the offline fallback/status (see fetchMap's doc).
  useEffect(() => {
    let cancelled = false;
    if (!active || !enoughChannels) {
      setPayload(null);
      return;
    }
    const controller = new AbortController();
    const opts = { method, nx: res, ny: res };
    fetchMap(active.data, keys[0], keys[1], keys[2], opts, controller.signal)
      .then((p) => {
        if (cancelled) return;
        setPayload(p);
        if (p.fallback) setStatus(`backend unavailable — offline grid, ${p.fallback.nx}×${p.fallback.ny}`);
      })
      .catch(() => {}); // aborted (superseded) -- nothing to show
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [active, enoughChannels, keys, method, res, setStatus]);

  // Box, ruler, and the sector wedge take precedence over the cut tool while
  // armed — all four drive the same canvas pointer gestures, so only one may
  // own them at a time (armExclusively's invariant). `routedTool` picks
  // whichever ONE is armed so onMove/onClick/onDown/onUp need one dispatch
  // point instead of an if-block per tool (mapToolArming.ts's own doc).
  const roiArmed = roi.mode === "roi" && cutSpace != null;
  const rulerArmed = ruler.mode === "ruler" && cutSpace != null;
  const wedgeArmed = wedge.mode === "sector" && cutSpace === "q";
  const routed = routedTool([
    { armed: roiArmed, ...roi },
    { armed: rulerArmed, ...ruler },
    { armed: wedgeArmed, ...wedge },
  ]);

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

  function savePng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stem = active?.name.replace(/\.[^.]+$/, "") ?? "map";
    exportCanvasPng(canvas, `${stem}_map.png`);
  }

  // Box ROI, cut ruler, the sector wedge, and the H/V/seg cut tool are
  // mutually exclusive (same canvas gestures) — arming one disarms the rest.
  const { setCutMode, toggleRoi, toggleRuler, toggleWedge } = armExclusively(roi, ruler, wedge, cuts);

  return (
    <div className="qzk-stage">
      <div ref={hostRef} style={{ position: "absolute", inset: 8 }}>
        <canvas
          ref={canvasRef}
          tabIndex={roi.rect || ruler.ruler ? 0 : -1}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            cursor: routed ? routed.cursor : cuts.mode === "off" ? "default" : "crosshair",
          }}
          onMouseMove={pointer.onMove}
          onMouseLeave={() => {
            pointer.onLeave();
            roi.onLeave();
            ruler.onLeave();
            wedge.onLeave();
          }}
          onClick={pointer.onClick}
          onDoubleClick={pointer.onDoubleClick}
          onMouseDown={pointer.onDown}
          onMouseUp={pointer.onUp}
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
        {payload && cutSpace != null && hostSize.w > 0 && hostSize.h > 0 && (
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
            rulerState={ruler}
            wedgeState={wedge}
          />
        )}
      </div>

      {active && enoughChannels && (
        <MapToolbar
          datasetId={dsId}
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
          onSavePng={savePng}
        />
      )}

      {!active && (
        <div className="qzk-ds-meta" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          Select a dataset to map
        </div>
      )}
      {active && !enoughChannels && (
        <div className="qzk-ds-meta" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
          A 2-D map needs at least 3 channels (x, y, z).
          <br />
          This dataset has {labels.length}.
        </div>
      )}

      {readout && (
        <div className="qzk-glass qzk-readout">
          {fmt(readout.x)}, {fmt(readout.y)} : {readout.z == null ? "—" : fmt(readout.z)}
        </div>
      )}
    </div>
  );
}

