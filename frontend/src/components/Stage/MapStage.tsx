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
import { useActiveDataset, useApp } from "../../store/useApp";
import { draw, fmt, hitTest, type Readout } from "./mapRender";
import { useMapCuts } from "./useMapCuts";

export default function MapStage() {
  const active = useActiveDataset();
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
  // Segment-drag state in canvas pixels (for the SVG preview line).
  const [dragPx, setDragPx] = useState<{ a: [number, number]; b: [number, number] } | null>(null);

  // Reset the channel picks to 0/1/2 when the active dataset changes.
  useEffect(() => {
    setKeys([0, 1, Math.min(2, Math.max(0, labels.length - 1))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // Fetch + regrid whenever the dataset or channel picks change.
  useEffect(() => {
    let cancelled = false;
    if (!active || !enoughChannels) {
      setPayload(null);
      return;
    }
    fetchMap(active.data, keys[0], keys[1], keys[2], { method, nx: res, ny: res }).then((p) => {
      if (!cancelled) setPayload(p);
    });
    return () => {
      cancelled = true;
    };
  }, [active, enoughChannels, keys, method, res]);

  // (Re)paint the canvas when the grid / colormap / theme / size change.
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    // Show peak markers only when they belong to the active dataset.
    const markers = rsmPeaks && rsmPeaks.datasetId === active?.id ? rsmPeaks.peaks : null;
    const contour = { on: contourOn, levelCount: contourLevelCount, scale: contourScale };
    const paint = () => draw(canvas, host, payload, cmap, logZ, markers, antialias, contour);
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

  function onMove(ev: React.MouseEvent<HTMLCanvasElement>) {
    const { r, px } = hitAt(ev);
    setReadout(r);
    if (dragPx) setDragPx({ a: dragPx.a, b: px });
  }

  function onClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    if (cuts.mode !== "h" && cuts.mode !== "v") return;
    const { r } = hitAt(ev);
    if (r) cuts.runLine(cuts.mode, { x: r.x, y: r.y });
  }

  function onDown(ev: React.MouseEvent<HTMLCanvasElement>) {
    if (cuts.mode !== "seg") return;
    const { r, px } = hitAt(ev);
    if (r) setDragPx({ a: px, b: px });
  }

  function onUp(ev: React.MouseEvent<HTMLCanvasElement>) {
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

  return (
    <div className="qzk-stage">
      <div ref={hostRef} style={{ position: "absolute", inset: 8 }}>
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            cursor: cuts.mode === "off" ? "default" : "crosshair",
          }}
          onMouseMove={onMove}
          onMouseLeave={() => {
            setReadout(null);
            setDragPx(null);
          }}
          onClick={onClick}
          onMouseDown={onDown}
          onMouseUp={onUp}
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
      </div>

      {active && enoughChannels && (
        <div className="qzk-glass qzk-float-tools" style={{ gap: 8, padding: "6px 8px" }}>
          {qAvailable && (
            <>
              <button
                className={`qzk-tool-btn${keysAre(angularKeys) ? " active" : ""}`}
                title="Angular axes (2θ / ω)"
                onClick={() => angularKeys && setKeys(angularKeys)}
              >
                2θ/ω
              </button>
              <button
                className={`qzk-tool-btn${keysAre(qKeys) ? " active" : ""}`}
                title="Reciprocal-space axes (Qx / Qz)"
                onClick={() => qKeys && setKeys(qKeys)}
              >
                Q
              </button>
              <span className="qzk-tool-sep" />
            </>
          )}
          {(["X", "Y", "Z"] as const).map((axis, slot) => (
            <Picker
              key={axis}
              label={axis}
              value={keys[slot]}
              options={labels.map((lab, i) => ({ v: i, text: lab }))}
              onChange={(v) =>
                setKeys((k) => {
                  const next = [...k] as [number, number, number];
                  next[slot] = Number(v);
                  return next;
                })
              }
            />
          ))}
          <span className="qzk-tool-sep" />
          <Picker
            label="map"
            value={cmap}
            options={Object.keys(COLORMAPS).map((n) => ({ v: n, text: n }))}
            onChange={(v) => setCmap(v as ColormapName)}
          />
          <button
            className={`qzk-tool-btn${logZ ? " active" : ""}`}
            title="Log intensity scale (for high-dynamic-range data like RSM)"
            onClick={() => setLogZ((v) => !v)}
          >
            log
          </button>
          <button
            className={`qzk-tool-btn${contourOn ? " active" : ""}`}
            title="Contour lines (level count + lin/log spacing live in the Inspector's 2-D map card)"
            onClick={() => setContourOn(!contourOn)}
          >
            ∿
          </button>
          {cutSpace != null && (
            <>
              <span className="qzk-tool-sep" />
              {gridable && (
                <button
                  className={`qzk-tool-btn${cuts.mode === "h" ? " active" : ""}`}
                  title="H-cut: click the map → intensity vs the horizontal axis at that height (width averages a swath)"
                  onClick={() => cuts.setMode(cuts.mode === "h" ? "off" : "h")}
                >
                  ─
                </button>
              )}
              {gridable && (
                <button
                  className={`qzk-tool-btn${cuts.mode === "v" ? " active" : ""}`}
                  title="V-cut: click the map → intensity vs the vertical axis at that position"
                  onClick={() => cuts.setMode(cuts.mode === "v" ? "off" : "v")}
                >
                  │
                </button>
              )}
              <button
                className={`qzk-tool-btn${cuts.mode === "seg" ? " active" : ""}`}
                title="Segment cut: drag any line across the map → distance-parametrized linescan"
                onClick={() => cuts.setMode(cuts.mode === "seg" ? "off" : "seg")}
              >
                ∕
              </button>
              {gridable && (
                <button
                  className="qzk-tool-btn"
                  title="Project the whole map onto the horizontal axis (Σ over frames)"
                  onClick={() => cuts.runProjection("pixels")}
                >
                  Σx
                </button>
              )}
              {gridable && (
                <button
                  className="qzk-tool-btn"
                  title="Project the whole map onto the vertical axis (Σ over pixels — rocking-curve profile)"
                  onClick={() => cuts.runProjection("frames")}
                >
                  Σy
                </button>
              )}
              {cuts.mode !== "off" && (
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }} title="Cut width: average all lines within ±width/2 (0 = single line)">
                  w
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={cuts.width}
                    onChange={(e) => cuts.setWidth(Math.max(0, Number(e.target.value) || 0))}
                    style={{ width: 52 }}
                  />
                </label>
              )}
            </>
          )}
          <span className="qzk-tool-sep" />
          <button className="qzk-tool-btn" title="Save map as PNG" onClick={savePng}>
            ⤓
          </button>
        </div>
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

// A compact labeled <select> for the float toolbar (channel / colormap / grid).
function Picker({
  label,
  value,
  options,
  onChange,
  title,
}: {
  label: string;
  value: string | number;
  options: { v: string | number; text: string }[];
  onChange: (v: string) => void;
  title?: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }} title={title}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={String(o.v)} value={o.v}>
            {o.text}
          </option>
        ))}
      </select>
    </label>
  );
}

