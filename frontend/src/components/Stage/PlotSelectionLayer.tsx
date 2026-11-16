// UX-A: Pointer-tool selection on the plot. A click (not a drag: box zoom
// keeps its drag) on a curve, an axis or the legend selects it; a click on
// empty plot area clears; Esc clears. The selection is drawn as an accent
// halo over the canvas — a wide translucent stroke along the curve, or an
// outline round the axis band / legend box. Annotations, shapes and reference
// lines keep their own plugins: a click on one is left to it.
//
// Lazy (PlotStageOverlays mounts it through `lazyRegion`), and the halo is a
// DOM overlay, not a uPlot plugin, so neither the eager bundle nor the plot's
// option set changes. The plot zooms, pans and resizes without telling this
// overlay, so — like the magnifier inset's outline (InsetPlot.tsx) — a frame
// loop re-reads the geometry while something is selected and writes only on
// change. Selection is view state (store/plotSelection.ts): it is cleared when
// this plot unmounts or its dataset changes, and never saved.

import { useEffect, useRef, type RefObject } from "react";
import type uPlot from "uplot";

import { useEscapeSurface } from "../../lib/escapeStack";
import type { PlotTool } from "../../lib/uplotOpts";
import { selectPlotObject, selectionKey, usePlotSelection } from "../../store/plotSelection";
import { useApp } from "../../store/useApp";
import { haloGeometry, pickAt } from "./plotPick";

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
  const activeId = useApp((s) => s.activeId);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const boxRef = useRef<SVGRectElement>(null);

  // Selection belongs to this plot: drop it when the dataset changes or the
  // plot goes away.
  useEffect(() => () => selectPlotObject(null), [activeId]);
  // A selected curve that is no longer plotted is no longer selected.
  useEffect(() => {
    if (sel?.kind === "series" && !plotted.includes(sel.channel)) selectPlotObject(null);
  }, [sel, plotted]);

  useEscapeSurface("selection", () => (selectPlotObject(null), true), sel !== null);

  useEffect(() => {
    if (tool !== "pointer" || !plotRef) return;
    let down: [number, number] | null = null;
    const onDown = (e: MouseEvent) => {
      down = [e.clientX, e.clientY];
    };
    const onClick = (e: MouseEvent) => {
      const u = plotRef.current;
      const target = e.target instanceof Element ? e.target : null;
      const stage = u?.root?.closest(".qzk-stage");
      if (!u || !target || !stage?.contains(target)) return;
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > CLICK_SLOP) return;
      const pick = pickAt(u, target, e.clientX, e.clientY, plotted, hasY2);
      if (pick !== undefined) selectPlotObject(pick);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
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
      const svg = svgRef.current;
      const stage = svg?.parentElement;
      if (!u?.over || !stage || !pathRef.current || !boxRef.current) return;
      const g = haloGeometry(u, stage, sel, plotted);
      const key = JSON.stringify(g);
      if (key === last) return;
      last = key;
      pathRef.current.setAttribute("d", g.d);
      pathRef.current.setAttribute("stroke-width", String(g.width));
      const b = g.box;
      boxRef.current.setAttribute("display", b ? "inline" : "none");
      if (b) {
        boxRef.current.setAttribute("x", String(b.x));
        boxRef.current.setAttribute("y", String(b.y));
        boxRef.current.setAttribute("width", String(Math.max(0, b.w)));
        boxRef.current.setAttribute("height", String(Math.max(0, b.h)));
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
    <svg
      ref={svgRef}
      className="qzk-selection-halo"
      data-selection={selectionKey(sel)}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}
    >
      <path
        ref={pathRef}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: "var(--accent)", strokeOpacity: 0.35 }}
      />
      <rect
        ref={boxRef}
        display="none"
        rx={3}
        style={{ fill: "var(--accent)", fillOpacity: 0.08, stroke: "var(--accent)", strokeWidth: 2 }}
      />
    </svg>
  );
}
