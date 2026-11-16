// UX-A: Pointer-tool selection on the plot. A click (not a drag: box zoom
// keeps its drag) on a curve, an axis, a legend row (its curve) or the legend
// box selects it; a click on empty plot area clears; Esc clears. The
// selection is drawn as an accent halo over the canvas — a wide translucent
// stroke along the curve, clipped to the plot area, or an outline round the
// axis band / legend box. Annotations, shapes and reference lines keep their
// own plugins: a click on one is left to it.
//
// Lazy (PlotStageOverlays mounts it through `lazyRegion`), and the halo is a
// DOM overlay, not a uPlot plugin, so neither the eager bundle nor the plot's
// option set changes. The plot zooms, pans and resizes without telling this
// overlay, so — like the magnifier inset's outline (InsetPlot.tsx) — a frame
// loop watches it while something is selected; it reads only a cheap key of
// every input (`haloKey`) per frame and rebuilds the halo only when that key
// changes. Selection is view state (store/plotSelection.ts): it is cleared
// when this plot unmounts, its dataset or columns change, and never saved.

import { useEffect, useId, useRef, type RefObject } from "react";
import type uPlot from "uplot";

import { useEscapeSurface } from "../../lib/escapeStack";
import type { PlotTool } from "../../lib/uplotOpts";
import { selectPlotObject, selectionKey, usePlotSelection, useSelectionGuards } from "../../store/plotSelection";
import { useApp } from "../../store/useApp";
import { haloGeometry, haloKey, pickAt } from "./plotPick";
import "./plotSelection.css";

/** A press that moves further than this (CSS px) is a drag, not a click. */
const CLICK_SLOP = 4;

interface Props {
  plotRef?: RefObject<uPlot | null>;
  plotted: readonly number[];
  tool: PlotTool;
}

export default function PlotSelectionLayer({ plotRef, plotted, tool }: Props) {
  const sel = usePlotSelection((s) => s.sel);
  const hasY2 = useApp((s) => (s.y2Keys?.length ?? 0) > 0);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const boxRef = useRef<SVGRectElement>(null);
  const clipRef = useRef<SVGRectElement>(null);
  const clipId = `qzk-sel-clip-${useId().replace(/:/g, "")}`;

  useSelectionGuards();
  // Selection belongs to this plot: drop it when the plot goes away.
  useEffect(() => {
    usePlotSelection.setState({ onCanvas: true });
    return () => {
      selectPlotObject(null);
      usePlotSelection.setState({ onCanvas: false });
    };
  }, []);
  // A selected curve that is no longer plotted is no longer selected.
  useEffect(() => {
    if (sel?.kind === "series" && !plotted.includes(sel.channel)) selectPlotObject(null);
  }, [sel, plotted]);

  useEscapeSurface("selection", () => (selectPlotObject(null), true), sel !== null);

  useEffect(() => {
    if (tool !== "pointer" || !plotRef) return;
    let down: [number, number] | null = null;
    // The press: a pointer (mouse, pen, touch) or a mouse event, whichever
    // carries coordinates (a touch's compatibility mousedown repeats it).
    const onDown = (e: MouseEvent) => {
      if ((e as PointerEvent).isPrimary === false || !Number.isFinite(e.clientX)) return;
      down = [e.clientX, e.clientY];
    };
    const onClick = (e: MouseEvent) => {
      const from = down;
      down = null; // a click is measured against ITS press, never a stale one
      const u = plotRef.current;
      const target = e.target instanceof Element ? e.target : null;
      const stage = u?.root?.closest(".qzk-stage");
      if (!u || !target || !stage?.contains(target)) return;
      if (from && Math.hypot(e.clientX - from[0], e.clientY - from[1]) > CLICK_SLOP) return;
      if (e.altKey && target.closest(".qzk-legend")) return; // Alt+click: the row's hide/show
      const pick = pickAt(u, target, e.clientX, e.clientY, plotted, hasY2);
      if (pick !== undefined) selectPlotObject(pick);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [tool, plotRef, plotted, hasY2]);

  useEffect(() => {
    if (!sel || !plotRef) return;
    let raf = 0;
    let last = "";
    const tick = () => {
      const u = plotRef.current;
      const stage = svgRef.current?.parentElement;
      const path = pathRef.current;
      const box = boxRef.current;
      const clip = clipRef.current;
      if (!u?.over || !stage || !path || !box || !clip) return;
      const key = haloKey(u, stage, sel, plotted);
      if (key === last) return;
      last = key;
      const g = haloGeometry(u, stage, sel, plotted);
      path.setAttribute("d", g.d);
      path.setAttribute("stroke-width", String(g.width));
      clip.setAttribute("x", String(g.clip.x));
      clip.setAttribute("y", String(g.clip.y));
      clip.setAttribute("width", String(Math.max(0, g.clip.w)));
      clip.setAttribute("height", String(Math.max(0, g.clip.h)));
      const b = g.box;
      box.setAttribute("display", b ? "inline" : "none");
      if (b) {
        box.setAttribute("x", String(b.x));
        box.setAttribute("y", String(b.y));
        box.setAttribute("width", String(Math.max(0, b.w)));
        box.setAttribute("height", String(Math.max(0, b.h)));
      }
    };
    const loop = () => {
      tick();
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [sel, plotRef, plotted]);

  if (!sel) return null;
  return (
    <svg ref={svgRef} className="qzk-selection-halo" data-selection={selectionKey(sel)} aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect ref={clipRef} />
        </clipPath>
      </defs>
      <path ref={pathRef} className="qzk-selection-curve" clipPath={`url(#${clipId})`} />
      <rect ref={boxRef} className="qzk-selection-box" display="none" rx={3} />
    </svg>
  );
}
