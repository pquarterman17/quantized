// The map's Polygon tool: click to add vertices, double-click / Enter / a click on
// the first vertex to close, Backspace to take the last vertex back, Esc to
// abandon the outline, and drag a vertex of a closed polygon to move it. The
// closed polygon is `store.mapPolygon` (lib/roiPolygon.ts); the outline being
// drawn is local state, so nothing half-drawn ever reaches the store, a
// consumer or the project file. Same working-shape contract as the box
// (useMapRoi.ts): data coordinates, outside undo, shown only over the axes it
// was drawn on, exclusive with the box and the ruler.
//
// Esc goes through the shared gesture registry (lib/gestureCancel.ts) like the
// box and the ruler, so the app's one Escape ladder cancels it in a single step;
// the canvas keydown deliberately does not also act on Escape.

import { useRef, useState } from "react";

import { setActiveGestureCancel } from "../../lib/gestureCancel";
import { isDeleteKey } from "../../lib/deleteKey";
import { mapAxesOf, sameAxes, type RoiSpace } from "../../lib/mapBoxSpace";
import type { CutSpace } from "../../lib/mapcuts";
import type { MapPayload } from "../../lib/mapdataFetch";
import { closeProblem, moveVertex, polygonToPx, vertexAt, type RoiPolygon, type Vertex } from "../../lib/roiPolygon";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { dataToPx } from "./mapRender";
import { pxToData, type GenericMapAxes } from "./useMapRoi";

export type PolygonMode = "off" | "polygon";

type Px = [number, number];
/** A press this close (px) to the last vertex is the second click of a double-click, not a new vertex. */
const SAME_SPOT_PX = 3;
/** A press this close (px) to the first vertex of an outline with three or more vertices closes it. */
const CLOSE_PX = 8;

interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  preventDefault: () => void;
}

export interface UseMapPolygonState {
  mode: PolygonMode;
  setMode: (m: PolygonMode) => void;
  /** The closed polygon eligible to show / edit here (the axes it was drawn on are on screen), or null. */
  polygon: RoiPolygon | null;
  /** The outline being drawn (data coordinates), empty when none. */
  draft: Vertex[];
  /** Where the pointer is while drawing (px), for the rubber-band edge. */
  cursorPx: Px | null;
  /** The vertex under the pointer (hover), or -1. */
  hoverVertex: number;
  dragging: boolean;
  cursor: string;
  onDown: (payload: MapPayload, w: number, h: number, px: Px) => void;
  onMove: (payload: MapPayload, w: number, h: number, px: Px) => void;
  onUp: (px: Px) => void;
  onDoubleClick: () => void;
  onLeave: () => void;
  onKeyDown: (ev: KeyLike) => void;
  /** Take the closed polygon (and any outline in progress) away. */
  remove: () => void;
  /** The canvas should be keyboard-reachable: there is something to act on. */
  focusable: boolean;
}

export function useMapPolygon(active: Dataset | null, cutSpace: CutSpace | null, generic: GenericMapAxes | null): UseMapPolygonState {
  const stored = useApp((s) => s.mapPolygon);
  const setMapPolygon = useApp((s) => s.setMapPolygon);
  const setStatus = useApp((s) => s.setStatus);
  const [mode, setModeState] = useState<PolygonMode>("off");
  const [draft, setDraftState] = useState<Vertex[]>([]);
  const draftRef = useRef<Vertex[]>([]);
  const [cursorPx, setCursorPx] = useState<Px | null>(null);
  const [hoverVertex, setHoverVertex] = useState(-1);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ index: number; pre: RoiPolygon } | null>(null);

  const mapAxes = !cutSpace && generic ? mapAxesOf(generic.data.labels, generic.keys) : null;
  const space: RoiSpace | null = cutSpace ?? (mapAxes ? "map" : null);
  const polygon: RoiPolygon | null =
    stored && space && stored.space === space && (space !== "map" || sameAxes(stored.axes, mapAxes)) ? stored : null;

  const setDraft = (pts: Vertex[]): void => {
    draftRef.current = pts;
    setDraftState(pts);
  };

  /** Abandon the outline being drawn and any vertex drag in flight (the closed polygon is restored). */
  function cancelAll(): void {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setDraft([]);
    setCursorPx(null);
    setActiveGestureCancel(null);
    if (d) setMapPolygon(d.pre);
  }

  function close(): void {
    const pts = draftRef.current;
    const problem = closeProblem(pts);
    if (problem || !space) {
      setStatus(problem ?? "Polygon: this view has no axes to draw on.", "danger");
      return;
    }
    setMapPolygon({ space, ...(mapAxes ? { axes: mapAxes } : {}), points: pts });
    setDraft([]);
    setCursorPx(null);
    setActiveGestureCancel(null);
  }

  function onDown(payload: MapPayload, w: number, h: number, px: Px): void {
    if (mode !== "polygon" || !space || !active) return;
    const at = pxToData(payload, w, h, px[0], px[1]);
    if (!at) return;
    const project = (x: number, y: number) => dataToPx(payload, w, h, x, y);
    const pts = draftRef.current;
    if (pts.length > 0) {
      const first = project(pts[0]![0], pts[0]![1]);
      const last = project(pts[pts.length - 1]![0], pts[pts.length - 1]![1]);
      if (pts.length >= 3 && first && Math.hypot(px[0] - first[0], px[1] - first[1]) <= CLOSE_PX) {
        close();
        return;
      }
      if (last && Math.hypot(px[0] - last[0], px[1] - last[1]) < SAME_SPOT_PX) return;
      setDraft([...pts, [at.x, at.y]]);
      return;
    }
    const pxPts = polygon ? polygonToPx(polygon.points, project) : null;
    const index = pxPts ? vertexAt(pxPts, { x: px[0], y: px[1] }) : -1;
    if (polygon && index >= 0) {
      dragRef.current = { index, pre: polygon };
      setDragging(true);
    } else {
      setDraft([[at.x, at.y]]);
    }
    setActiveGestureCancel(cancelAll);
  }

  function onMove(payload: MapPayload, w: number, h: number, px: Px): void {
    if (mode !== "polygon") return;
    const d = dragRef.current;
    if (d) {
      const at = pxToData(payload, w, h, px[0], px[1]);
      if (at) setMapPolygon(moveVertex(d.pre, d.index, at.x, at.y));
      return;
    }
    if (draftRef.current.length > 0) {
      setCursorPx(px);
      return;
    }
    const pxPts = polygon ? polygonToPx(polygon.points, (x, y) => dataToPx(payload, w, h, x, y)) : null;
    setHoverVertex(pxPts ? vertexAt(pxPts, { x: px[0], y: px[1] }) : -1);
  }

  function onUp(): void {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    setActiveGestureCancel(null);
  }

  function onKeyDown(ev: KeyLike): void {
    const pts = draftRef.current;
    if (pts.length > 0) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        close();
      } else if (isDeleteKey(ev)) {
        ev.preventDefault(); // never the global Delete: that removes the dataset
        if (pts.length === 1) cancelAll();
        else setDraft(pts.slice(0, -1));
      }
      return;
    }
    if (polygon && isDeleteKey(ev)) {
      ev.preventDefault();
      setMapPolygon(null);
    }
  }

  const cursor = mode !== "polygon" ? "default" : dragging ? "grabbing" : hoverVertex >= 0 ? "move" : "crosshair";

  return {
    mode,
    setMode: (m) => {
      if (m !== "polygon") cancelAll();
      setModeState(m);
    },
    polygon,
    draft,
    cursorPx,
    hoverVertex,
    dragging,
    cursor,
    onDown,
    onMove,
    onUp,
    onDoubleClick: () => {
      if (draftRef.current.length > 0) close();
    },
    onLeave: () => {
      // Leaving the canvas ends a vertex drag where it is, like the box's own leave.
      if (dragRef.current) cancelAll();
      setHoverVertex(-1);
    },
    onKeyDown,
    remove: () => {
      cancelAll();
      setMapPolygon(null);
    },
    focusable: polygon !== null || draft.length > 0,
  };
}
