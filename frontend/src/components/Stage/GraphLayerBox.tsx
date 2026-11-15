// One graph layer's box on the plot (origin gap audit 3 #15): placed every
// frame so the layer's rect — an inset graph's PLOT AREA, or the image /
// table itself — lands on `at`, fractions of the main plot frame, exactly
// where the export puts it (`calc/figure_layers.py`). Drag moves it, the
// corner grip resizes it, arrow keys nudge it (Shift: 5%), Delete removes it,
// Enter or a double-click opens its properties; each edit is one undo step.
// On a background window (`windowId`) the edit lands on that window's view
// and the window takes focus afterwards (the frame leaves a press on the box
// alone: `data-inset-box`).

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type uPlot from "uplot";

import type { GraphLayer, LayerAt } from "../../lib/graphLayers";
import { insetBoxRect, movedAt, resizedAt, type PxRect } from "../../lib/inset";
import { resolvePlotBg } from "../../lib/uplotOpts";
import { openFigureDialog } from "../../store/figureDialogs";
import { layerNoun, patchLayer, removeLayer } from "../../store/graphLayerEdit";
import type { PlotBg } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import InsetLayerPlot from "./InsetLayerPlot";

const NUDGE = 0.01;

function TableBody({ layer, ink, fill }: { layer: Extract<GraphLayer, { kind: "table" }>; ink: string; fill: string }) {
  const width = Math.max(1, ...layer.rows.map((r) => r.length));
  const cell = { border: `1px solid ${ink}`, padding: "0 3px", textAlign: "center", overflow: "hidden", whiteSpace: "nowrap" } as const;
  return (
    <table style={{ width: "100%", height: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 9, color: ink, background: fill }}>
      <tbody>
        {layer.rows.map((r, i) => (
          <tr key={i}>
            {Array.from({ length: width }, (_, j) => (
              <td key={j} style={{ ...cell, fontWeight: layer.header && i === 0 ? 700 : 400 }}>{r[j] ?? ""}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function GraphLayerBox({
  layer,
  datasets,
  plotRef,
  windowId,
  bg,
}: {
  layer: GraphLayer;
  datasets: readonly Dataset[];
  plotRef?: RefObject<uPlot | null>;
  windowId?: string;
  bg?: PlotBg;
}) {
  const focusWindow = useApp((s) => s.focusWindow);
  useApp((s) => s.theme); // re-ink on a theme switch
  const boxRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLElement | null>(null);
  const atRef = useRef<LayerAt>(layer.at);
  const frameRef = useRef<PxRect | null>(null);
  const dragRef = useRef<{ x: number; y: number; at: LayerAt; mode: "move" | "size" } | null>(null);
  const [dragging, setDragging] = useState(false);
  if (!dragRef.current) atRef.current = layer.at;
  const noun = layerNoun(layer);
  const focusSoon = () => void setTimeout(() => windowId && focusWindow(windowId), 0);
  const commit = (at: LayerAt, history: string) => {
    patchLayer(layer.id, { at }, history, windowId);
    focusSoon();
  };
  const openProps = () => {
    if (windowId) focusWindow(windowId);
    setTimeout(() => openFigureDialog({ kind: "graphLayer", id: layer.id }), 0);
  };

  // Place the box on every frame: the main plot zooms, pans and resizes
  // without telling this overlay. Writes the style only on change.
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const box = boxRef.current;
      const stage = box?.parentElement;
      const fr = plotRef?.current?.over?.getBoundingClientRect();
      if (!box || !stage || !fr?.width || !fr.height) return;
      const sr = stage.getBoundingClientRect();
      const frame = { left: fr.left - sr.left, top: fr.top - sr.top, width: fr.width, height: fr.height };
      frameRef.current = frame;
      const ar = areaRef.current?.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      const g = ar?.width ? { l: ar.left - br.left, t: ar.top - br.top, r: br.right - ar.right, b: br.bottom - ar.bottom } : { l: 0, t: 0, r: 0, b: 0 };
      const r = insetBoxRect(frame, atRef.current, g);
      const key = JSON.stringify(r);
      if (key === last) return;
      last = key;
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [plotRef]);

  const start = (mode: "move" | "size") => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, at: atRef.current, mode };
    setDragging(true);
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    const frame = frameRef.current;
    if (!d || !frame) return;
    atRef.current = (d.mode === "move" ? movedAt : resizedAt)(d.at, frame, e.clientX - d.x, e.clientY - d.y);
  };
  const end = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDragging(false);
    if (atRef.current.some((v, i) => v !== d.at[i])) commit(atRef.current, `${d.mode === "move" ? "move" : "resize"} ${noun}`);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") return void (e.preventDefault(), openProps());
    if (e.key === "Delete" || e.key === "Backspace") return void (e.preventDefault(), removeLayer(layer.id, windowId));
    const step = e.shiftKey ? NUDGE * 5 : NUDGE;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const [l, t, w, h] = layer.at;
    const c = (v: number, hi: number) => Math.min(Math.max(v, 0), hi);
    commit([c(l + d[0], 1 - w), c(t + d[1], 1 - h), w, h], `move ${noun}`);
  };
  const { inkColor: ink, axesBg } = resolvePlotBg(bg);
  const label = layer.kind === "image" ? `Image ${layer.name}` : noun[0].toUpperCase() + noun.slice(1);

  return (
    <div
      ref={boxRef}
      role="group"
      tabIndex={0}
      aria-label={`${label}. Drag to move, Enter for properties, Delete to remove.`}
      title={`${label}: drag to move, double-click for properties`}
      data-testid="graph-layer"
      data-layer-kind={layer.kind}
      data-inset-box={windowId ? "" : undefined}
      className="qz-graph-layer"
      onPointerDown={start("move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={openProps}
      onKeyDown={onKey}
      style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, outline: dragging ? "1px dashed var(--accent)" : undefined, touchAction: "none" }}
    >
      {layer.kind === "inset" && <InsetLayerPlot layer={layer} datasets={datasets} areaRef={areaRef} bg={bg} />}
      {layer.kind === "image" && (
        <img src={layer.src} alt={layer.name} draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", pointerEvents: "none" }} />
      )}
      {layer.kind === "table" && <TableBody layer={layer} ink={ink} fill={axesBg} />}
      <div
        aria-hidden="true"
        title={`Drag to resize the ${noun}.`}
        onPointerDown={start("size")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ position: "absolute", right: -5, bottom: -5, width: 10, height: 10 }}
      />
    </div>
  );
}
