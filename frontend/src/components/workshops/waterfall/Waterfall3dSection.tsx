// The waterfall workshop's 3-D section (lazy): the included curves as a static
// 3-D waterfall -- server-rendered preview, and Export in PDF / SVG / PNG as the
// SAME request (`waterfall3d.ts`). Depth is the curve order or the number in each
// name. Settings live with the workshop window (not the `.dwk`).

import { useMemo, useState } from "react";

import { exportMapFigure } from "../../../lib/api/mapFigure";
import type { WaterfallSeries } from "../../../lib/waterfall";
import { useApp } from "../../../store/useApp";
import { useMap3dImage } from "../../Stage/useMap3dImage";
import { curveWaterfallBody, type DepthBy } from "./waterfall3d";

const ROW = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } as const;

export default function Waterfall3dSection({ series, channel }: { series: readonly WaterfallSeries[]; channel: string }) {
  const setStatus = useApp((s) => s.setStatus);
  const [depth, setDepth] = useState<DepthBy>("index");
  const [elev, setElev] = useState("30");
  const [azim, setAzim] = useState("-60");
  const e = Number(elev);
  const a = Number(azim);
  const opts = useMemo(() => ({ channel, depth, elev: e, azim: a, cmap: "viridis", style: "default", title: "" }), [channel, depth, e, a]);
  const built = useMemo(() => curveWaterfallBody(series, opts, "png", "preview"), [series, opts]);
  const body = built.ok ? built.body : null;
  const shot = useMap3dImage(body);
  const exportAs = async (fmt: string) => {
    const r = curveWaterfallBody(series, opts, fmt, `waterfall3d_${channel}`);
    if (!r.ok) return setStatus(`3-D waterfall export refused — ${r.error}`);
    try {
      await exportMapFigure(r.body);
      setStatus(`exported waterfall3d_${channel}.${fmt}`);
    } catch (e) {
      setStatus(`3-D waterfall export failed — ${e instanceof Error ? e.message : "error"}`);
    }
  };
  const note = !built.ok ? built.error : shot && "error" in shot ? shot.error : null;
  return (
    <div role="group" aria-label="3-D waterfall" style={{ display: "grid", gap: 6 }}>
      <div style={ROW}>
        <label className="qzk-field">
          <span>Depth by</span>
          <select className="qz-input" aria-label="Depth by" value={depth} onChange={(e) => setDepth(e.target.value as DepthBy)}>
            <option value="index">Curve order</option>
            <option value="number">Number in name</option>
          </select>
        </label>
        <label className="qzk-field">
          <span>Elev °</span>
          <input className="qz-input" aria-label="3-D elevation" type="number" style={{ width: 64 }} value={elev} onChange={(e) => setElev(e.target.value)} />
        </label>
        <label className="qzk-field">
          <span>Azim °</span>
          <input className="qz-input" aria-label="3-D azimuth" type="number" style={{ width: 64 }} value={azim} onChange={(e) => setAzim(e.target.value)} />
        </label>
      </div>
      <div style={{ minHeight: 200, display: "grid", placeItems: "center", background: "var(--surface-1)" }}>
        {note ? (
          <div role="alert" className="qzk-ds-meta qzk-msg" style={{ padding: 12, color: "var(--danger)" }}>
            3-D waterfall not drawn — {note}
          </div>
        ) : shot && "url" in shot ? (
          <img alt="3-D waterfall preview" src={shot.url} style={{ maxWidth: "100%", maxHeight: 260 }} />
        ) : (
          <div className="qzk-ds-meta">Rendering 3-D waterfall…</div>
        )}
      </div>
      <div style={ROW}>
        {["pdf", "svg", "png"].map((f) => (
          <button key={f} className="qz-btn" disabled={!built.ok} onClick={() => void exportAs(f)}>
            Export 3-D {f.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
