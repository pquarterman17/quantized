// Magnifier inset: a small uPlot of the same series pinned over the plot,
// seeded to a magnified central x-range and independently box-zoomable (drag to
// focus any feature while the main plot keeps the full scan). One-way — takes
// the active payload as a prop; no cross-plot sync.
//
// Plot audit leftovers: the inset is VIEW STATE now (`PlotView.inset`), so it
// saves with the window and exports as drawn (`calc/figure_inset.py`). Its
// source region (x, and y as drawn — `yZoom` marks a user zoom) is written on
// every zoom; its PLOT AREA sits at `at`, fractions of the main plot's frame,
// which is exactly where the export puts its inset axes, so the box is placed
// around that rect by its own measured gutters. The header drags it, the
// corner grip resizes it. The source region is outlined on the main plot with
// the connector lines the export draws (`lib/inset.insetIndicator`, the rule
// in `tests/fixtures/wire/inset_connectors.json`). A background window's
// inset (`view`) reads the window's saved geometry and writes nothing.

import { useEffect, useId, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import uPlot from "uplot";
import { LINEAR_PATHS, POINTS_PATHS } from "../../lib/uplotPaths";
import "uplot/dist/uPlot.min.css";

import {
  ascending, centralRange, clampAt, insetBoxRect, insetIndicator, movedAt, resizedAt, type Gutters, type PxRect,
} from "../../lib/inset";
import type { PlotPayload } from "../../lib/plotdata";
import type { InsetView, PlotView } from "../../lib/plotview";
import { buildOpts, resolvePlotBg } from "../../lib/uplotOpts";
import type { SeriesCycle } from "../../lib/seriesStyleCycle";
import type { SeriesStyle } from "../../lib/types";
import { useApp } from "../../store/useApp";

interface Props {
  payload: PlotPayload;
  styleList?: (SeriesStyle | undefined)[];
  /** P3.3: the SAME cycle positions the stage behind this magnifier was built
   *  with (`lib/seriesStyleCycle.ts`). The inset is a second view of exactly
   *  those series at exactly those display positions, so it must resolve the
   *  same dash/glyph — and the export copies those very lines. */
  seriesCycle?: SeriesCycle;
  /** A background window's own view; omitted, the focused plot's. The inset
   *  magnifies the plot behind it, so it draws on that plot's scales. */
  view?: Pick<PlotView, "xScale" | "yScale" | "y2Scale" | "xReversed"> & Partial<Pick<PlotView, "inset" | "showGrid">>;
  /** The plot this inset magnifies: its frame places the inset and its scales
   *  map the source outline. Absent: the inset sits in the corner, no outline. */
  plotRef?: RefObject<uPlot | null>;
  /** Per-series visibility (the interactive legend): a hidden series is not drawn here either. */
  hidden?: boolean[];
}

/** Chrome around the inset's plot area before its uPlot has measured it. */
const GUESS: Gutters = { l: 52, t: 30, r: 10, b: 36 };
const HEADER = 22;
const CORNER_STYLE = "right:14px;bottom:14px;width:280px;height:168px;left:auto;top:auto";

const finiteXs = (p: PlotPayload) => (p.data[0] as (number | null)[]).filter((v): v is number => v != null && Number.isFinite(v));

/** The saved source x if it still lands on the data, else the seeded central third. */
function seedX(saved: InsetView | null, xs: number[]): [number, number] | null {
  if (!xs.length) return null;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (saved && ascending(saved.x) && saved.x[1] > lo && saved.x[0] < hi) return saved.x;
  const r = centralRange(lo, hi, 0.3);
  return r[1] > r[0] ? r : null;
}

export default function InsetPlot({ payload, styleList, seriesCycle, view, plotRef: mainRef, hidden }: Props) {
  const liveX = useApp((s) => s.xScale);
  const liveY = useApp((s) => s.yScale);
  const liveY2 = useApp((s) => s.y2Scale);
  const liveRev = useApp((s) => s.xReversed);
  const liveInset = useApp((s) => s.inset);
  const liveGrid = useApp((s) => s.showGrid);
  const xScale = view ? view.xScale : liveX;
  const yScale = view ? view.yScale : liveY;
  const y2Scale = view ? view.y2Scale : liveY2;
  const xReversed = view ? view.xReversed : liveRev;
  const saved = view ? (view.inset ?? null) : liveInset;
  const showGrid = view ? (view.showGrid ?? true) : liveGrid;
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const setInsetMode = useApp((s) => s.setInsetMode);
  const recordHistory = useApp((s) => s.recordHistory);
  const boxRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null); // the source outline, under the inset
  const wireRef = useRef<SVGSVGElement>(null); // the connectors, over its chrome (to its plot area)
  const plotRef = useRef<uPlot | null>(null);
  const savedRef = useRef(saved);
  const atRef = useRef<InsetView["at"]>(clampAt(saved?.at));
  const dragRef = useRef<{ x: number; y: number; at: InsetView["at"]; mode: "move" | "size" } | null>(null);
  const frameRef = useRef<PxRect | null>(null);
  const yZoomRef = useRef(false);
  const clipId = `inset-clip-${useId().replace(/[^\w-]/g, "")}`;
  savedRef.current = saved;
  if (!dragRef.current) atRef.current = clampAt(saved?.at);
  const lines = saved?.lines ?? true;
  const linesRef = useRef(lines);
  linesRef.current = lines;

  /** Write `patch` over the saved inset (focused window only; equal = no-op). */
  const commit = (patch: Partial<InsetView>, history?: string) => {
    if (view) return;
    const cur = savedRef.current; // the store's, as of the last render or commit
    const x = patch.x ?? cur?.x;
    if (!x) return;
    const next: InsetView = { y: null, yZoom: false, at: atRef.current, lines: true, ...cur, ...patch, x };
    if (JSON.stringify(next) === JSON.stringify(cur)) return;
    if (history) recordHistory(history);
    savedRef.current = next;
    useApp.setState({ inset: next });
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    plotRef.current?.destroy();
    const w = host.clientWidth || 248;
    const h = host.clientHeight || 124;
    const opts = buildOpts(payload, {
      width: w,
      height: h,
      yScale,
      xScale,
      y2Scale: y2Scale ?? undefined,
      xReversed,
      showGrid,
      hidden,
      tool: "zoom", // drag to re-zoom the inset
      onReadout: () => {},
      seriesStyles: styleList,
      seriesCycle,
      linearPaths: LINEAR_PATHS,
      pointsPaths: POINTS_PATHS,
    });
    // Compact: drop axis titles (the corner box is too small for them).
    opts.axes?.forEach((ax) => {
      ax.label = undefined;
    });
    // Record the region as drawn after every zoom; `yZoom` is true only for a
    // y range the user dragged (an autoscaled y re-ranges on the next draw).
    let applying = true;
    let gesture = false;
    let queued = false;
    const capture = (u: uPlot) => {
      queued = false;
      const { min: x0, max: x1 } = u.scales?.x ?? {};
      const { min: y0, max: y1 } = u.scales?.y ?? {};
      if (x0 == null || x1 == null || !(x1 > x0)) return;
      const y: [number, number] | null = y0 != null && y1 != null && y1 > y0 ? [y0, y1] : null;
      commitRef.current({ x: [x0, x1], y, yZoom: yZoomRef.current && y !== null });
    };
    const onScale = (u: uPlot, key: string) => {
      if (applying) return;
      if (key === "y") yZoomRef.current = gesture;
      if (queued) return;
      queued = true;
      setTimeout(() => capture(u), 0);
    };
    opts.hooks = { ...opts.hooks, setScale: [...(opts.hooks?.setScale ?? []), onScale] };
    const u = new uPlot(opts, payload.data, host);
    // Seed the saved (or a magnified central) view *after* creation: a static
    // scale range would pin it and disable box-zoom; setScale leaves it zoomable.
    const s = savedRef.current;
    const x = seedX(s, finiteXs(payload));
    if (x) u.setScale("x", { min: x[0], max: x[1] });
    const keepY = !!(s?.yZoom && ascending(s.y) && (yScale === "linear" || s.y[0] > 0));
    if (keepY && s?.y) u.setScale("y", { min: s.y[0], max: s.y[1] });
    yZoomRef.current = keepY;
    applying = false;
    capture(u);
    const over = u.over as HTMLElement | undefined;
    const down = (e: MouseEvent) => void (gesture = e.button === 0);
    const up = () => void setTimeout(() => (gesture = false), 0);
    const reset = () => void (gesture = false); // a double-click resets to auto
    over?.addEventListener?.("mousedown", down);
    over?.addEventListener?.("dblclick", reset, true);
    window.addEventListener("mouseup", up);
    plotRef.current = u;

    const ro = new ResizeObserver(() =>
      plotRef.current?.setSize({ width: host.clientWidth || w, height: host.clientHeight || h }),
    );
    ro.observe(host);
    return () => {
      ro.disconnect();
      window.removeEventListener("mouseup", up);
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [payload, styleList, seriesCycle, theme, accent, xScale, yScale, y2Scale, xReversed, hidden, showGrid]);

  // Place the box and draw the outline every frame (the main plot zooms, pans
  // and resizes without telling this overlay). Writes only on change.
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const box = boxRef.current;
      const main = mainRef?.current;
      const stage = box?.parentElement;
      if (!box || !stage) return;
      const fr = main?.over?.getBoundingClientRect();
      if (!main || !fr?.width || !fr.height) {
        if (last !== "corner") box.style.cssText += `;${CORNER_STYLE}`;
        last = "corner";
        svgRef.current?.setAttribute("display", "none");
        wireRef.current?.setAttribute("display", "none");
        return;
      }
      const sr = stage.getBoundingClientRect();
      const frame = { left: fr.left - sr.left, top: fr.top - sr.top, width: fr.width, height: fr.height };
      frameRef.current = frame;
      const ins = plotRef.current;
      const ir = ins?.over?.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      const g = ir?.width ? { l: ir.left - br.left, t: ir.top - br.top, r: br.right - ir.right, b: br.bottom - ir.bottom } : GUESS;
      const r = insetBoxRect(frame, atRef.current, g);
      const sx = ins?.scales.x;
      const sy = ins?.scales.y;
      const src = sx?.min != null && sx.max != null && sy?.min != null && sy.max != null
        ? [main.valToPos(sx.min, "x"), main.valToPos(sy.min, "y"), main.valToPos(sx.max, "x"), main.valToPos(sy.max, "y")]
        : null;
      const key = JSON.stringify([r, frame, src, linesRef.current]);
      if (key === last) return;
      last = key;
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, right: "auto", bottom: "auto" });
      const svg = svgRef.current;
      const wire = wireRef.current;
      if (!svg || !wire || !src) return;
      svg.removeAttribute("display");
      wire.removeAttribute("display");
      const ind = insetIndicator(frame, [src[0] + frame.left, src[1] + frame.top, src[2] + frame.left, src[3] + frame.top], atRef.current, linesRef.current);
      const [clip, rect] = svg.querySelectorAll("rect");
      for (const [el, v] of [[clip, frame], [rect, ind.rect]] as const) {
        el.setAttribute("x", String(v.left));
        el.setAttribute("y", String(v.top));
        el.setAttribute("width", String(Math.max(0, v.width)));
        el.setAttribute("height", String(Math.max(0, v.height)));
      }
      wire.querySelectorAll("line").forEach((ln, i) => {
        const sgm = ind.segments[i];
        ln.setAttribute("display", sgm ? "inline" : "none");
        if (sgm) ["x1", "y1", "x2", "y2"].forEach((a, k) => ln.setAttribute(a, String(sgm[k])));
      });
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [mainRef]);

  const startDrag = (mode: "move" | "size") => (e: ReactPointerEvent<HTMLElement>) => {
    if (view || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, at: atRef.current, mode };
  };
  const onDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    const frame = frameRef.current;
    if (!d || !frame) return;
    const move = d.mode === "move" ? movedAt : resizedAt;
    atRef.current = move(d.at, frame, e.clientX - d.x, e.clientY - d.y);
  };
  const endDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    commit({ at: atRef.current }, d.mode === "move" ? "move inset" : "resize inset");
  };
  const dragProps = (mode: "move" | "size") => ({
    onPointerDown: startDrag(mode), onPointerMove: onDrag, onPointerUp: endDrag, onPointerCancel: endDrag,
  });
  // The plot's dimmed axis ink, as the inset's own axes (themed like it, `theme` above).
  const stroke = resolvePlotBg().inkDimColor;

  const layer = { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" } as const;
  const ink = { stroke, strokeWidth: 1, opacity: 0.75 };

  return (
    <>
      <svg ref={svgRef} aria-hidden="true" display="none" data-testid="inset-indicator" style={layer}>
        <defs><clipPath id={clipId}><rect /></clipPath></defs>
        <rect clipPath={`url(#${clipId})`} fill="none" {...ink} />
      </svg>
      <div ref={boxRef} className="qzk-glass" data-testid="inset-box"
        style={{ position: "absolute", right: 14, bottom: 14, width: 280, height: 168, padding: 6 }}>
        <div
          {...dragProps("move")}
          title={view ? undefined : "Drag to move the inset."}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, color: "var(--text-faint)", height: HEADER - 6, marginBottom: 2 }}
        >
          <span>inset · drag to zoom</span>
          <span style={{ display: "flex", gap: 2 }}>
            <button aria-label="Connector lines" aria-pressed={lines} className="qzk-tool-btn" title="Show lines to the magnified region."
              onClick={() => commit({ lines: !lines }, "toggle inset lines")}>
              ⤡
            </button>
            <button aria-label="Close inset" className="qzk-tool-btn" title="Close inset" onClick={() => setInsetMode(false)}>
              ×
            </button>
          </span>
        </div>
        <div ref={hostRef} style={{ position: "absolute", left: 6, right: 6, top: HEADER, bottom: 6 }} />
        {!view && (
          <div {...dragProps("size")} aria-label="Resize inset" title="Drag to resize the inset."
            style={{ position: "absolute", right: 0, bottom: 0, width: 10, height: 10 }} />
        )}
      </div>
      {/* Over the box: a connector ends on the inset's PLOT AREA, across its tick labels, as exported. */}
      <svg ref={wireRef} aria-hidden="true" display="none" data-testid="inset-connectors" style={layer}>
        <line {...ink} display="none" />
        <line {...ink} display="none" />
      </svg>
    </>
  );
}
