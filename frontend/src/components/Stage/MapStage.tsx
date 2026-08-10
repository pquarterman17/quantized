// 2-D map viewer: a Canvas2D heatmap of three scattered channels (x, y, z)
// regridded onto a regular grid (backend /api/plot/map, client fallback). The
// grid is painted to an offscreen nx×ny canvas then blitted scaled — one GPU
// up-scale instead of nx·ny rects. NaN cells (outside the data hull) are
// transparent (gaps), matching uPlot's null = gap for 1-D.

import { useEffect, useRef, useState } from "react";

import { COLORMAPS, type ColormapName } from "../../lib/colormap";
import { cutSpaceForKeys } from "../../lib/mapcuts";
import { fetchMap, hasQSpace, rsmAxisKeys, type MapPayload } from "../../lib/mapdata";
import { exportCanvasPng } from "../../lib/plotExport";
import type { Dataset } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import MapRoiOverlay from "./MapRoiOverlay";
import MapToolbar from "./MapToolbar";
import { armExclusively } from "./mapToolArming";
import { draw, fmt, hitTest, type Readout } from "./mapRender";
import { useMapCuts } from "./useMapCuts";
import { useMapRoi } from "./useMapRoi";
import { useMapRuler } from "./useMapRuler";

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
  const [cmap, setCmap] = useState<ColormapName>("viridis");
  const [logZ, setLogZ] = useState(false);
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
  const [readout, setReadout] = useState<Readout | null>(null);
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
  // Segment-drag state in canvas pixels (for the SVG preview line).
  const [dragPx, setDragPx] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  // Host box size in CSS px, kept in sync by the paint effect below (the
  // SAME ResizeObserver that already exists for the canvas) — the ROI
  // overlay needs it to convert data<->px through the SAME plotRect the
  // canvas paints with, and refs aren't a reliable read during render.
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });

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

  // (Re)paint the canvas when the grid / colormap / theme / size change.
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    // Show peak markers only when they belong to the active dataset.
    const markers = rsmPeaks && rsmPeaks.datasetId === active?.id ? rsmPeaks.peaks : null;
    const contour = { on: contourOn, levelCount: contourLevelCount, scale: contourScale };
    const paint = () => {
      draw(canvas, host, payload, cmap, logZ, markers, antialias, contour);
      const w = host.clientWidth;
      const h = host.clientHeight;
      setHostSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    return () => ro.disconnect();
    // theme/accent in deps so the frame/axis ink recolors from fresh tokens.
  }, [
    payload,
    cmap,
    logZ,
    theme,
    accent,
    rsmPeaks,
    active,
    antialias,
    contourOn,
    contourLevelCount,
    contourScale,
  ]);

  function hitAt(ev: React.MouseEvent<HTMLCanvasElement>): {
    r: Readout | null;
    px: [number, number];
  } {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!payload || !canvas || !host) return { r: null, px: [0, 0] };
    const rect = canvas.getBoundingClientRect();
    const px: [number, number] = [ev.clientX - rect.left, ev.clientY - rect.top];
    return { r: hitTest(payload, host.clientWidth, host.clientHeight, px[0], px[1]), px };
  }

  // ROI/ruler handlers take precedence over the cut tool while armed — all
  // three drive the same canvas pointer gestures, so only one may own them
  // at a time.
  const roiArmed = roi.mode === "roi" && cutSpace != null;
  const rulerArmed = ruler.mode === "ruler" && cutSpace != null;

  function onMove(ev: React.MouseEvent<HTMLCanvasElement>) {
    const { r, px } = hitAt(ev);
    setReadout(r);
    if (roiArmed && payload) {
      roi.onMove(payload, hostSize.w, hostSize.h, px);
      return;
    }
    if (rulerArmed && payload) {
      ruler.onMove(payload, hostSize.w, hostSize.h, px);
      return;
    }
    if (dragPx) setDragPx({ a: dragPx.a, b: px });
  }

  function onClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    if (roiArmed || rulerArmed) return;
    if (cuts.mode !== "h" && cuts.mode !== "v") return;
    const { r } = hitAt(ev);
    if (r) cuts.runLine(cuts.mode, { x: r.x, y: r.y });
  }

  function onDown(ev: React.MouseEvent<HTMLCanvasElement>) {
    if (roiArmed && payload) {
      const { px } = hitAt(ev);
      roi.onDown(payload, hostSize.w, hostSize.h, px);
      return;
    }
    if (rulerArmed && payload) {
      const { px } = hitAt(ev);
      ruler.onDown(payload, hostSize.w, hostSize.h, px);
      return;
    }
    if (cuts.mode !== "seg") return;
    const { r, px } = hitAt(ev);
    if (r) setDragPx({ a: px, b: px });
  }

  function onUp(ev: React.MouseEvent<HTMLCanvasElement>) {
    if (roiArmed) {
      const { px } = hitAt(ev);
      roi.onUp(px);
      return;
    }
    if (rulerArmed) {
      const { px } = hitAt(ev);
      ruler.onUp(px);
      return;
    }
    if (cuts.mode !== "seg" || !dragPx) return;
    const canvas = canvasRef.current;
    const host = hostRef.current;
    setDragPx(null);
    if (!payload || !canvas || !host) return;
    const start = hitTest(payload, host.clientWidth, host.clientHeight, dragPx.a[0], dragPx.a[1]);
    const { r: end } = hitAt(ev);
    if (start && end) cuts.runSegment({ x: start.x, y: start.y }, { x: end.x, y: end.y });
  }

  function savePng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stem = active?.name.replace(/\.[^.]+$/, "") ?? "map";
    exportCanvasPng(canvas, `${stem}_map.png`);
  }

  // Box ROI, cut ruler, and the H/V/seg cut tool are mutually exclusive
  // (same canvas gestures) — arming one disarms the other two.
  const { setCutMode, toggleRoi, toggleRuler } = armExclusively(roi, ruler, cuts);

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
            cursor: roiArmed ? roi.cursor : rulerArmed ? ruler.cursor : cuts.mode === "off" ? "default" : "crosshair",
          }}
          onMouseMove={onMove}
          onMouseLeave={() => {
            setReadout(null);
            setDragPx(null);
            roi.onLeave();
            ruler.onLeave();
          }}
          onClick={onClick}
          onMouseDown={onDown}
          onMouseUp={onUp}
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
        {payload && cutSpace != null && hostSize.w > 0 && hostSize.h > 0 && (
          <MapRoiOverlay
            payload={payload}
            w={hostSize.w}
            h={hostSize.h}
            cutSpace={cutSpace}
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
            rulerState={ruler}
          />
        )}
      </div>

      {active && enoughChannels && (
        <MapToolbar
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
          onCmapChange={setCmap}
          logZ={logZ}
          onToggleLogZ={() => setLogZ((v) => !v)}
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

