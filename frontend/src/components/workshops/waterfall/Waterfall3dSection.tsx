// The waterfall workshop's 3-D section (lazy): the included curves as a 3-D
// waterfall -- an INTERACTIVE view (drag / wheel / arrow keys, `Stage/Map3D/`)
// or the server's static render ("Export preview"), and Export in PDF / SVG /
// PNG as the SAME request (`waterfall3d.ts`) from the angles and zoom on
// screen. Depth is the curve order or the number in each name. Angles commit
// on blur / Enter (a blank one is invalid, not 0). Settings live with the
// workshop window (not the `.dwk`).

import { useMemo, useState } from "react";

import { exportMapFigure } from "../../../lib/api/mapFigure";
import type { View3d } from "../../../lib/project3d";
import type { WaterfallSeries } from "../../../lib/waterfall";
import { useApp } from "../../../store/useApp";
import AngleField from "../../Stage/AngleField";
import Map3dCanvas from "../../Stage/Map3D/Map3dCanvas";
import { sceneFromBody } from "../../Stage/Map3D/scene3d";
import { useMap3dImage } from "../../Stage/useMap3dImage";
import { curveWaterfallBody, type DepthBy } from "./waterfall3d";

const ROW = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } as const;
const HOME: View3d = { elev: 30, azim: -60, zoom: 1 };

export interface Waterfall3dSectionProps {
  series: readonly WaterfallSeries[];
  channel: string;
  /** Axis labels with units, from the datasets ("H (T)", "M (emu)"). */
  xLabel?: string;
  zLabel?: string;
}

export default function Waterfall3dSection({ series, channel, xLabel, zLabel }: Waterfall3dSectionProps) {
  const setStatus = useApp((s) => s.setStatus);
  const [depth, setDepth] = useState<DepthBy>("index");
  const [cam, setCam] = useState<View3d>(HOME);
  const [mode, setMode] = useState<"interactive" | "static">("interactive");
  const { elev, azim, zoom } = cam;
  const opts = useMemo(
    () => ({ channel, depth, elev, azim, zoom, cmap: "viridis", style: "default", title: "", xLabel, zLabel }),
    [channel, depth, elev, azim, zoom, xLabel, zLabel],
  );
  const built = useMemo(() => curveWaterfallBody(series, opts, "png", "preview"), [series, opts]);
  // The scene is the request's data; the camera only re-projects it.
  const scene = useMemo(() => {
    const r = curveWaterfallBody(series, { ...opts, ...HOME }, "png", "preview");
    return r.ok ? sceneFromBody(r.body) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the camera is deliberately not an input
  }, [series, channel, depth, xLabel, zLabel]);
  const { shot, busy } = useMap3dImage(built.ok && mode === "static" ? built.body : null);
  const exportAs = async (fmt: string) => {
    const r = curveWaterfallBody(series, opts, fmt, `waterfall3d_${channel}`);
    if (!r.ok) return setStatus(`3-D waterfall export refused — ${r.error}`, "danger");
    try {
      await exportMapFigure(r.body);
      setStatus(`exported waterfall3d_${channel}.${fmt}`);
    } catch (e) {
      setStatus(`3-D waterfall export failed — ${e instanceof Error ? e.message : "error"}`, "danger");
    }
  };
  const sceneError = scene && "error" in scene ? scene.error : null;
  const note = !built.ok ? built.error : sceneError ?? (mode === "static" && shot && "error" in shot && !busy ? shot.error : null);
  return (
    <div role="group" aria-label="3-D waterfall" style={{ display: "grid", gap: 6 }}>
      <div style={ROW}>
        <label className="qzk-field">
          <span>Depth by</span>
          <select className="qz-select" aria-label="Depth by" value={depth} onChange={(e) => setDepth(e.target.value as DepthBy)}>
            <option value="index">Curve order</option>
            <option value="number">Number in name</option>
          </select>
        </label>
        <AngleField label="Elevation (°)" value={elev} lim={90} onCommit={(v) => setCam((c) => ({ ...c, elev: v }))} />
        <AngleField label="Azimuth (°)" value={azim} lim={360} onCommit={(v) => setCam((c) => ({ ...c, azim: v }))} />
      </div>
      {/* Export first: the buttons stay in view whatever the preview's size. */}
      <div style={ROW}>
        {["pdf", "svg", "png"].map((f) => (
          <button key={f} className="qz-btn" disabled={!built.ok} onClick={() => void exportAs(f)}>
            Export 3-D {f.toUpperCase()}
          </button>
        ))}
        <label className="qzk-field">
          <span>Show</span>
          <select className="qz-select" aria-label="3-D view mode" value={mode} onChange={(e) => setMode(e.target.value as "interactive" | "static")}>
            <option value="interactive">Interactive</option>
            <option value="static">Export preview</option>
          </select>
        </label>
      </div>
      <div aria-busy={mode === "static" && built.ok && busy} style={{ position: "relative", height: mode === "interactive" && !note ? 300 : undefined, minHeight: 120, display: "grid", placeItems: "center", background: "var(--surface-1)" }}>
        {note ? (
          <div role="alert" className="qzk-ds-meta qzk-msg" style={{ padding: 12, color: "var(--danger)" }}>
            3-D waterfall not drawn — {note}
          </div>
        ) : mode === "interactive" ? (
          scene && !("error" in scene) && (
            <Map3dCanvas scene={scene} view={cam} home={HOME} label={`3-D waterfall of ${channel}`} onCommit={setCam} />
          )
        ) : shot && "url" in shot ? (
          <img alt="3-D waterfall preview" src={shot.url} style={{ maxWidth: "100%", maxHeight: 200, opacity: busy ? 0.4 : 1 }} />
        ) : (
          <div className="qzk-ds-meta">Rendering 3-D waterfall…</div>
        )}
      </div>
    </div>
  );
}
