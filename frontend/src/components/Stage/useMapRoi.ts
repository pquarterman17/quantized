// Box-ROI gesture state machine for the 2-D map (RSM_CUTS_PLAN item 6): the
// draw-by-eye half of the owner's original request ("I need to be able to
// draw a box by eye... and I want to be able to move the box by clicking and
// dragging while it's over the data"). idle -> (draw|move|resize) -> idle in
// DATA coords, over the SAME `store.mapRoi` field the numeric ROI panel
// (item 8's workshops/roicuts) reads and writes — a box drawn here and one
// typed there are literally one value, no syncing effect needed or wanted
// (store/rois.ts's header explains why that field is deliberately NOT
// cleared on a dataset switch: repeat-across-datasets IS the point).
//
// Geometry (hit-test/classify/drag math) lives in lib/roi.ts; this hook is
// the thin wiring layer over it PLUS the two things that belong beside a
// live gesture: the rAF-coalesced client preview (lib/roiMath.ts — NEVER the
// commit path, see that module's header) and the inline bar's backend
// actions (the two ∫ buttons land a dataset via useCutLanding; Stats fetches box_stats
// directly — neither of those two APIs is on the drag path, only on a click).
//
// px<->data conversion reuses `mapRender.ts`'s own exported `plotRect`/
// `hitTest`/`dataToPx` (the SAME projector the canvas paints and the pointer
// readout use) rather than re-deriving the margins here — "never recompute
// the projection" per the plan.

import { useEffect, useMemo, useRef, useState } from "react";

import { rsmBoxCut, rsmBoxStats, type BoxCutRequest, type BoxStats, type BoxStatsRequest } from "../../lib/api/rsm";
import { cancelActiveGesture, setActiveGestureCancel } from "../../lib/gestureCancel";
import type { CutSpace } from "../../lib/mapcuts";
import { rsmAxisKeys, type MapPayload } from "../../lib/mapdataFetch";
import {
  applyRoiDrag,
  classifyRoiHit,
  normalizeRect,
  nudgeRoi,
  rectToPx,
  roiBoxBody,
  roiCursor,
  roiStatsBody,
  type NudgeDir,
  type RoiHit,
  type RoiRect,
} from "../../lib/roi";
import { boxProfileLocal, boxStatsLocal, type BoxCols, type RoiBoxStats, type RoiProfile } from "../../lib/roiMath";
import type { Dataset, DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import type { RoiMode } from "./MapToolbar";
import { dataToPx, hitTest, plotRect } from "./mapRender";
import { useCutLanding } from "./useCutLanding";

// ── Pure-ish local helpers (kept private — no other module needs these) ────

/** One payload grid cell along an axis — the nudge step AND the drag/click
 *  minimum rect size both key off it (a box smaller than a cell selects
 *  nothing meaningful anyway). Exported: `useMapRuler.ts` (item 7) needs the
 *  identical cell-size math for its own nudge step and default ruler width —
 *  one implementation, not a second copy. */
export function cellSize(axis: number[]): number {
  return axis.length >= 2 ? Math.abs(axis[1]! - axis[0]!) : 1;
}

/** px -> data, clamped to the plot rect so a drag that strays past the map's
 *  border (still inside the canvas) keeps tracking instead of losing the
 *  gesture — built from the SAME exported `plotRect`/`hitTest` the canvas
 *  paint and pointer readout already share. Exported for `useMapRuler.ts`
 *  (same reasoning as `cellSize`). */
export function pxToData(payload: MapPayload, w: number, h: number, px: number, py: number): { x: number; y: number } | null {
  const rect = plotRect(payload, w, h);
  const cx = Math.min(rect.x + rect.w, Math.max(rect.x, px));
  const cy = Math.min(rect.y + rect.h, Math.max(rect.y, py));
  const r = hitTest(payload, w, h, cx, cy);
  return r ? { x: r.x, y: r.y } : null;
}

/** Flat x/y/intensity columns for `space`, mirroring `_rsm_grid.scatter_columns`
 *  (2Theta/axis1 for "angular", Qx/Qz for "q") — the caller-picked column set
 *  `roiMath.ts` documents itself as expecting. `map_shape` rides along
 *  unconditionally; `boxProfileLocal` only consults it on the angular,
 *  unrotated, unwrapped path, so passing it for a Q rect is harmless.
 *  Exported for `useMapRuler.ts` (same column shape, same reasoning as
 *  `cellSize`/`pxToData`). */
export function boxColsFor(ds: DataStruct, space: CutSpace, axis1Name: string): BoxCols | null {
  const keys = rsmAxisKeys(ds.labels, axis1Name, space);
  if (!keys) return null;
  const [xi, yi, zi] = keys;
  const n = ds.values.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const intensity = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = ds.values[i]!;
    x[i] = row[xi]!;
    y[i] = row[yi]!;
    intensity[i] = row[zi]!;
  }
  const shape = ds.metadata?.["map_shape"];
  const mapShape: [number, number] | null =
    Array.isArray(shape) && shape.length === 2 ? [Number(shape[0]), Number(shape[1])] : null;
  return { x, y, intensity, mapShape };
}

type DragKind = "draw" | "move" | "resize";

interface DragState {
  kind: DragKind;
  hit: RoiHit;
  startPx: [number, number];
  startData: { x: number; y: number };
  baseRect: RoiRect;
  /** The RAW store value before this gesture started (any space, or null) —
   *  restored verbatim on cancel/Esc/leave/sub-3px click. A "draw" gesture's
   *  pre-gesture value is whatever was there before (often null, sometimes a
   *  hidden differently-spaced box) — never assumed to be null. */
  preGesture: RoiRect | null;
}

export interface UseMapRoiState {
  mode: RoiMode;
  setMode: (m: RoiMode) => void;
  /** The box actually eligible to show/drag right now — null when nothing is
   *  drawn OR the stored rect was drawn in a different space than `cutSpace`
   *  (Resolved decisions: "no silent angular<->Q conversion", overlay hides
   *  on mismatch). */
  rect: RoiRect | null;
  hover: RoiHit;
  dragging: boolean;
  cursor: string;

  onDown: (payload: MapPayload, w: number, h: number, px: [number, number]) => void;
  onMove: (payload: MapPayload, w: number, h: number, px: [number, number]) => void;
  onUp: (px: [number, number]) => void;
  onLeave: () => void;
  onKeyDown: (ev: { key: string; shiftKey: boolean; preventDefault: () => void }, payload: MapPayload) => void;
  /** Same effect as Delete/Backspace on a focused map, reachable by mouse —
   *  see MapRoiOverlay's CommitBarProps.onRemove for why that matters. */
  remove: () => void;

  /** Client preview (lib/roiMath.ts), rAF-coalesced — LOCAL to this hook,
   *  never written to the store, never landed. */
  preview: RoiProfile | null;
  previewAxis: "x" | "y";
  setPreviewAxis: (axis: "x" | "y") => void;
  previewStats: RoiBoxStats | null;

  /** The bar's two ∫ buttons — POST /api/rsm/box, landed via useCutLanding.
   *  Still keyed "x"/"y" (the collapse axis); what the buttons are LABELLED
   *  is the map's own axis names, derived in `roiAxisNames.ts`. */
  commitIntegrate: (axis: "x" | "y") => void;
  landingBusy: boolean;

  /** Stats glyph — POST /api/rsm/box-stats, shown inline (not landed: a
   *  scalar dict has no dataset to land). */
  commitStats: () => void;
  statsBusy: boolean;
  apiStats: BoxStats | null;
  statsError: string | null;
  clearStats: () => void;
}

export function useMapRoi(active: Dataset | null, cutSpace: CutSpace | null): UseMapRoiState {
  const storeRect = useApp((s) => s.mapRoi);
  const setMapRoi = useApp((s) => s.setMapRoi);
  // Box and ruler are mutually exclusive WORKING SHAPES (RSM_CUTS_PLAN item
  // 7) — starting a fresh box draw retires any live ruler so the map never
  // shows both at once; the mirror image lives in useMapRuler.ts.
  const setMapRuler = useApp((s) => s.setMapRuler);
  const { busy: landingBusy, land } = useCutLanding();

  const [mode, setMode] = useState<RoiMode>("off");
  const [hover, setHover] = useState<RoiHit>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  const [previewAxis, setPreviewAxis] = useState<"x" | "y">("x");
  const [preview, setPreview] = useState<RoiProfile | null>(null);
  const [previewStats, setPreviewStats] = useState<RoiBoxStats | null>(null);

  const [apiStats, setApiStats] = useState<BoxStats | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Only a rect drawn in the CURRENTLY DISPLAYED space is eligible — see the
  // field's own doc. `rect` stays referentially equal to `storeRect` when the
  // spaces match, so effects keyed on it don't churn on unrelated re-renders.
  const rect: RoiRect | null = storeRect && cutSpace && storeRect.space === cutSpace ? storeRect : null;

  const axis1Name = String(active?.data.metadata?.["axis1_name"] ?? "Omega");
  const cols = useMemo(() => {
    if (!active || !cutSpace) return null;
    return boxColsFor(active.data, cutSpace, axis1Name);
  }, [active, cutSpace, axis1Name]);

  // Live preview: rAF-coalesced, at most one compute scheduled at a time —
  // each dependency change cancels the PREVIOUS pending frame (React effect
  // cleanup) before scheduling a fresh one, so a burst of rect updates
  // within one frame collapses to the last one, matching every OTHER
  // rAF-throttled drag in this codebase (PlotLegend.tsx's own convention).
  // Preview math NEVER touches the network — see roiMath.ts's header.
  useEffect(() => {
    if (!rect || !cols) {
      setPreview(null);
      setPreviewStats(null);
      return;
    }
    const raf = requestAnimationFrame(() => {
      setPreview(boxProfileLocal(cols, rect, { collapse: previewAxis }));
      setPreviewStats(boxStatsLocal(cols, rect));
    });
    return () => cancelAnimationFrame(raf);
  }, [rect, cols, previewAxis]);

  // A moved/resized/redrawn box makes any PREVIOUS backend Stats reading
  // stale — clear it rather than show a confirmed number for a box that no
  // longer exists.
  useEffect(() => {
    setApiStats(null);
    setStatsError(null);
  }, [rect]);

  function cancelDrag(): void {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setActiveGestureCancel(null);
    if (d) setMapRoi(d.preGesture);
  }

  function onDown(payload: MapPayload, w: number, h: number, px: [number, number]): void {
    if (mode !== "roi" || !cutSpace || !active) return;
    const dataPt = pxToData(payload, w, h, px[0], px[1]);
    if (!dataPt) return;
    const project = (x: number, y: number) => dataToPx(payload, w, h, x, y);
    const rectPx = rect ? rectToPx(rect, project) : null;
    const hitAtDown = rectPx ? classifyRoiHit(rectPx, { x: px[0], y: px[1] }) : null;

    let kind: DragKind;
    let hit: RoiHit;
    let baseRect: RoiRect;
    if (rect && hitAtDown) {
      kind = hitAtDown.kind === "inside" ? "move" : "resize";
      hit = hitAtDown;
      baseRect = rect;
    } else {
      kind = "draw";
      hit = { kind: "handle", index: 4 }; // SE corner: anchors x0/y0, follows x1/y1
      baseRect = { space: cutSpace, x0: dataPt.x, x1: dataPt.x, y0: dataPt.y, y1: dataPt.y };
      setMapRoi(baseRect);
      setMapRuler(null); // a fresh box draw retires any live ruler
    }

    dragRef.current = { kind, hit, startPx: px, startData: dataPt, baseRect, preGesture: storeRect };
    setDragging(true);
    setActiveGestureCancel(cancelDrag);
  }

  function onMove(payload: MapPayload, w: number, h: number, px: [number, number]): void {
    if (mode !== "roi") return;
    const d = dragRef.current;
    if (!d) {
      if (!rect) {
        setHover(null);
        return;
      }
      const project = (x: number, y: number) => dataToPx(payload, w, h, x, y);
      const rectPx = rectToPx(rect, project);
      setHover(rectPx ? classifyRoiHit(rectPx, { x: px[0], y: px[1] }) : null);
      return;
    }
    const dataPt = pxToData(payload, w, h, px[0], px[1]);
    if (!dataPt) return;
    const dx = dataPt.x - d.startData.x;
    const dy = dataPt.y - d.startData.y;
    const minW = cellSize(payload.xAxis);
    const minH = cellSize(payload.yAxis);
    setMapRoi(applyRoiDrag(d.baseRect, d.hit, dx, dy, minW, minH));
  }

  function onUp(px: [number, number]): void {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setActiveGestureCancel(null);
    if (!d) return;
    // A drag under ~3px is a click, not a gesture — discard it (this covers
    // BOTH a fresh draw that never grew and a stray click on an existing box).
    const dist = Math.hypot(px[0] - d.startPx[0], px[1] - d.startPx[1]);
    if (dist < 3) setMapRoi(d.preGesture);
  }

  function onLeave(): void {
    // Mirrors the existing segment-cut onMouseLeave contract: leaving the
    // canvas mid-gesture aborts it (same effect as Esc), never commits.
    if (dragRef.current) cancelDrag();
  }

  function onKeyDown(ev: { key: string; shiftKey: boolean; preventDefault: () => void }, payload: MapPayload): void {
    if (!rect) return;
    const dirs: Record<string, NudgeDir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    const dir = dirs[ev.key];
    if (dir) {
      ev.preventDefault();
      const cell = dir === "left" || dir === "right" ? cellSize(payload.xAxis) : cellSize(payload.yAxis);
      setMapRoi(nudgeRoi(rect, dir, (ev.shiftKey ? 10 : 1) * cell));
      return;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      setMapRoi(null);
    }
  }

  function commitIntegrate(axis: "x" | "y"): void {
    if (!active || !rect) return;
    const body = roiBoxBody(active.data, normalizeRect(rect), { collapse: axis }) as unknown as BoxCutRequest;
    void land(rsmBoxCut(body));
  }

  async function commitStats(): Promise<void> {
    if (!active || !rect) return;
    setStatsBusy(true);
    setStatsError(null);
    try {
      const body = roiStatsBody(active.data, normalizeRect(rect)) as unknown as BoxStatsRequest;
      setApiStats(await rsmBoxStats(body));
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : "box stats failed");
    } finally {
      setStatsBusy(false);
    }
  }

  const draggingHit = dragging ? (dragRef.current?.hit ?? null) : null;
  const cursor =
    mode !== "roi" ? "default" : draggingHit ? roiCursor(draggingHit) : hover ? roiCursor(hover) : "crosshair";

  return {
    mode,
    setMode: (m) => {
      // Disarming (or the tool becoming unreachable) mid-drag must abort the
      // gesture the same way Esc does — never leave a half-drawn box behind.
      if (m !== "roi") cancelActiveGesture();
      setMode(m);
    },
    rect,
    hover,
    dragging,
    cursor,
    onDown,
    onMove,
    onUp,
    onLeave,
    onKeyDown,
    /** Same effect as Delete/Backspace on a focused map, reachable by mouse —
     *  see MapRoiOverlay's CommitBarProps.onRemove for why that matters. */
    remove: () => setMapRoi(null),
    preview,
    previewAxis,
    setPreviewAxis,
    previewStats,
    commitIntegrate,
    landingBusy,
    commitStats: () => void commitStats(),
    statsBusy,
    apiStats,
    statsError,
    clearStats: () => setApiStats(null),
  };
}
