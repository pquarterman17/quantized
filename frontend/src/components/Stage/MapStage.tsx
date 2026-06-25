// 2-D map viewer: a Canvas2D heatmap of three scattered channels (x, y, z)
// regridded onto a regular grid (backend /api/plot/map, client fallback). The
// grid is painted to an offscreen nx×ny canvas then blitted scaled — one GPU
// up-scale instead of nx·ny rects. NaN cells (outside the data hull) are
// transparent (gaps), matching uPlot's null = gap for 1-D.

import { useEffect, useRef, useState } from "react";

import { COLORMAPS, type ColormapName } from "../../lib/colormap";
import { fetchMap, hasQSpace, rsmAxisKeys, type MapPayload } from "../../lib/mapdata";
import { exportCanvasPng } from "../../lib/plotExport";
import { useActiveDataset, useApp } from "../../store/useApp";
import { draw, fmt, hitTest, type Readout } from "./mapRender";

export default function MapStage() {
  const active = useActiveDataset();
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [payload, setPayload] = useState<MapPayload | null>(null);
  const [cmap, setCmap] = useState<ColormapName>("viridis");
  const [logZ, setLogZ] = useState(false);
  const [method, setMethod] = useState("natural"); // regrid interpolation method
  const [res, setRes] = useState(200); // grid resolution (nx = ny)
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
    const paint = () => draw(canvas, host, payload, cmap, logZ);
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    return () => ro.disconnect();
    // theme/accent in deps so the frame/axis ink recolors from fresh tokens.
  }, [payload, cmap, logZ, theme, accent]);

  function onMove(ev: React.MouseEvent<HTMLCanvasElement>) {
    if (!payload) return;
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const rect = canvas.getBoundingClientRect();
    const r = hitTest(payload, host.clientWidth, host.clientHeight, ev.clientX - rect.left, ev.clientY - rect.top);
    setReadout(r);
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
          style={{ width: "100%", height: "100%", display: "block" }}
          onMouseMove={onMove}
          onMouseLeave={() => setReadout(null)}
        />
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
          <span className="qzk-tool-sep" />
          <Picker
            label="grid"
            title="Scattered-data interpolation method"
            value={method}
            options={["natural", "linear", "nearest", "idw"].map((m) => ({ v: m, text: m }))}
            onChange={setMethod}
          />
          <Picker
            label="res"
            title="Grid resolution (nx = ny)"
            value={res}
            options={[100, 200, 400].map((n) => ({ v: n, text: String(n) }))}
            onChange={(v) => setRes(Number(v))}
          />
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

