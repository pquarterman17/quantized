// The interactive 3-D view (gap audit 5, item 3d; Origin's Rotate tool):
// Canvas2D, orthographic (`lib/project3d.ts`), no dependency. Drag to rotate,
// wheel to zoom, arrow keys / +/- / 0 from the keyboard, hover for the x/y/z
// of the vertex under the pointer. The view is the caller's (`view` in,
// `onCommit` once per gesture), so the static export reads the same angles.
//
// Rendering: back panes and grid, the marks (decimated while moving, full when
// still), axis lines with ticks and titles, the colour bar. Colours are the
// design tokens, re-read on a theme change.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { actionReset } from "../../../lib/glyphs";
import type { View3d } from "../../../lib/project3d";
import { useApp } from "../../../store/useApp";
import { fmt } from "../mapColorbar";
import { drawScene, inPlot } from "./render3d";
import { frameFor, type Ink } from "./render3dAxes";
import { pick, pickSet, type PickSet } from "./render3dMarks";
import type { Scene3d } from "./scene3d";
import { useOrbit } from "./useOrbit";

export interface Map3dCanvasProps {
  scene: Scene3d;
  view: View3d;
  onCommit: (v: View3d) => void;
  /** Reset target (the 3-D default view). */
  home: View3d;
  /** Extra controls for the toolbar row (the host's own). */
  children?: ReactNode;
  /** Accessible name of the plot ("3-D surface of I"). */
  label: string;
}

function token(name: string, fallback: string): string {
  const v = typeof getComputedStyle === "function" ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : "";
  return v || fallback;
}

function inks(): Ink & { mesh: string; drop: string } {
  const text = token("--text", "#e6e6e6");
  return {
    text,
    dim: token("--text-dim", "#9aa"),
    grid: token("--grid-line", "rgba(128,128,128,0.25)"),
    pane: token("--surface-1", "rgba(128,128,128,0.12)"),
    border: token("--border", "rgba(128,128,128,0.4)"),
    ui: token("--font-ui", "system-ui, sans-serif"),
    mesh: token("--axes-bg", "#111"),
    drop: token("--text-dim", "#9aa"),
  };
}

const zText = (s: Scene3d, z: number) => (s.log10 ? fmt(10 ** z) : fmt(z));

export default function Map3dCanvas({ scene, view: stored, onCommit, home, children, label }: Map3dCanvasProps) {
  const theme = useApp((s) => s.theme);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const orbit = useOrbit(stored, onCommit, home);
  const { view, moving } = orbit;
  const picks = useRef<PickSet | null>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The wheel must not scroll the page under the plot: a non-passive listener.
  const wheel = useRef(orbit.onWheel);
  wheel.current = orbit.onWheel;
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      wheel.current(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY);
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, []);

  const frame = useMemo(() => (size.w && size.h ? frameFor(scene, view, size.w, size.h) : null), [scene, view, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !frame) return;
    const raf = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      const ink = inks();
      const stats = drawScene(ctx, frame, scene, ink, moving, dpr);
      canvas.dataset.drawn = String(stats.drawn);
      canvas.dataset.fast = moving ? "1" : "0";
      picks.current = moving ? null : pickSet(frame, scene);
    });
    return () => cancelAnimationFrame(raf);
  }, [frame, scene, moving, size, theme]);

  useEffect(() => setHover(null), [scene, view]);

  const readout = hover && picks.current && hover.i < picks.current.x.length ? picks.current : null;
  const say = (v: View3d) => `elevation ${Math.round(v.elev)}°, azimuth ${Math.round(v.azim)}°, zoom ${v.zoom.toFixed(2)}×`;
  const angles = say(view);
  return (
    <div data-map3d-interactive="" style={{ position: "absolute", inset: 0, display: "grid", gridTemplateRows: "auto 1fr", background: "var(--axes-bg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 8px", fontSize: 11 }}>
        <button type="button" className="qz-btn" onClick={orbit.resetView} title="Reset view (0 or Home)" aria-label="Reset 3-D view">
          {actionReset} Reset view
        </button>
        <span className="qzk-helptext" data-map3d-angles="">{angles}</span>
        {/* Announced once per COMMITTED view, never per pointer move. */}
        <span className="qz-sr-only" aria-live="polite" data-map3d-announce="">{say(stored)}</span>
        {children}
        <span className="qzk-helptext" style={{ marginLeft: "auto" }}>Drag to rotate · wheel to zoom · arrow keys, +/−, 0</span>
      </div>
      <div
        ref={hostRef}
        role="application"
        aria-roledescription="3-D plot"
        tabIndex={0}
        aria-label={`${label}. Drag or use the arrow keys to rotate, the wheel or plus and minus to zoom, 0 to reset.`}
        className="qzk-map3d-host"
        style={{ position: "relative", minHeight: 0, overflow: "hidden", touchAction: "none", cursor: "default" }}
        onPointerDown={orbit.onPointerDown}
        onPointerMove={(e) => {
          if (orbit.onPointerMove(e)) return;
          const set = picks.current;
          const r = hostRef.current?.getBoundingClientRect();
          if (!set || !r || !frame) return;
          const px = e.clientX - r.left, py = e.clientY - r.top;
          const hit = inPlot(frame, px, py) ? pick(set, px, py) : null;
          // A vertex the clip hides (past the plot's edge) is not read either.
          const i = hit !== null && inPlot(frame, set.sx[hit], set.sy[hit]) ? hit : null;
          setHover(i === null ? null : { i, x: set.sx[i], y: set.sy[i] });
        }}
        onPointerUp={orbit.onPointerUp}
        onPointerCancel={orbit.onPointerUp}
        onLostPointerCapture={orbit.onLostPointerCapture}
        onPointerLeave={() => {
          setHover(null);
          orbit.flush();
        }}
        onBlur={orbit.flush}
        onKeyDown={orbit.onKeyDown}
      >
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
        {readout && hover && (
          <>
            <div aria-hidden style={{ position: "absolute", left: hover.x - 5, top: hover.y - 5, width: 10, height: 10, borderRadius: "50%", border: "2px solid var(--accent)", pointerEvents: "none" }} />
            <div className="qzk-glass qzk-readout" data-map3d-readout="" style={{ pointerEvents: "none" }}>
              {scene.x.label || "x"} {fmt(readout.x[hover.i])} · {scene.y.label || "y"} {fmt(readout.y[hover.i])} · {scene.z.label || "z"} {zText(scene, readout.z[hover.i])}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
