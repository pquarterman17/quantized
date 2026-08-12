// Cut-ruler gesture state machine for the 2-D map (RSM_CUTS_PLAN item 7):
// radial/transverse cuts about a peak, and free-hand rulers drawn the same
// draw/move/resize way the box is (useMapRoi.ts), but over the RoiRuler
// primitive (Resolved decisions rev 2: centre+angle+length+width, NO
// rotation handle — angle is set by dragging an endpoint). Structurally a
// sibling of useMapRoi.ts, not a fork glued onto it: box and ruler are
// mutually exclusive WORKING SHAPES (store.mapRoi / store.mapRuler) — a
// fresh "draw" gesture here retires any live box (the mirror image lives in
// useMapRoi.ts's own onDown), so the map never shows both at once.
//
// Geometry (rulerCorners/classifyRulerHit/applyRulerDrag/roiCursor) lives in
// lib/roi.ts — trust its tested behaviour (a previous agent already fixed a
// sign error in the width-handle case) over intuition about the corner
// mapping. This hook is the thin wiring layer over it, PLUS the same two
// things useMapRoi.ts adds beside a live gesture: the rAF-coalesced client
// preview (lib/roiMath.ts — never the commit path) and the inline bar's
// backend actions (∫x/∫y land via useCutLanding; Stats fetches box_stats
// directly). `cellSize`/`pxToData`/`boxColsFor` are IMPORTED from
// useMapRoi.ts (not re-derived) — one implementation of each.
//
// Peak-anchored radial/transverse actions (the two-click epitaxial
// deliverable) do NOT go through this hook's gesture machine at all — they
// live in workshops/rsm/useRsm.ts, which only needs `store.setMapRuler` (to
// show the result here) and its own direct commit via useCutLanding (so the
// label can say "Radial cut — film peak", which box_cut has no notion of).
// This hook still renders/edits/commits whatever ruler is in the store,
// including one a peak action just planted — the display and inline-commit
// path is shared; only the CONSTRUCTION path differs.

import { useEffect, useMemo, useRef, useState } from "react";

import { rsmBoxCut, rsmBoxStats, type BoxCutRequest, type BoxStats, type BoxStatsRequest } from "../../lib/api/rsm";
import { cancelActiveGesture, setActiveGestureCancel } from "../../lib/gestureCancel";
import type { CutSpace } from "../../lib/mapcuts";
import type { MapPayload } from "../../lib/mapdata";
import {
  applyRulerDrag,
  classifyRulerHit,
  roiCursor,
  roiStatsBody,
  rulerBoxBody,
  rulerCorners,
  type NudgeDir,
  type RoiHit,
  type RoiRect,
  type RoiRuler,
} from "../../lib/roi";
import { boxProfileLocal, boxStatsLocal, type RoiBoxStats, type RoiProfile } from "../../lib/roiMath";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import type { RulerMode } from "./MapToolbar";
import { boxColsFor, cellSize, pxToData } from "./useMapRoi";
import { dataToPx } from "./mapRender";
import { useCutLanding } from "./useCutLanding";

/** A ruler's equivalent box bounds (centre ∓ half-length/half-width, in the
 *  ROI's own frame) — the SAME conversion `lib/roi.ts::rulerBoxBody` applies
 *  server-side, mirrored here so the client preview (`boxProfileLocal`/
 *  `boxStatsLocal`, both `RoiRect`-shaped) and `roiStatsBody` (Stats commit)
 *  can reuse those box-shaped functions verbatim instead of a 3rd/4th
 *  ruler-specific implementation of each. */
function rulerToRect(ruler: RoiRuler): RoiRect {
  const hl = ruler.length / 2;
  const hw = ruler.width / 2;
  return { space: ruler.space, x0: ruler.cx - hl, x1: ruler.cx + hl, y0: ruler.cy - hw, y1: ruler.cy + hw };
}

/** `rulerCorners(ruler)` projected to px, or null if any corner falls
 *  outside the plot area — the shared prerequisite for hit-testing and
 *  drawing the ruler outline. */
function rulerCornersPx(
  ruler: RoiRuler,
  project: (x: number, y: number) => [number, number] | null,
): { x: number; y: number }[] | null {
  const pts = rulerCorners(ruler).map((c) => project(c.x, c.y));
  if (pts.some((p) => !p)) return null;
  return pts.map((p) => ({ x: p![0], y: p![1] }));
}

/** Default ruler width for a hand-drawn (non-peak-anchored) ruler — "3 grid
 *  cells" in the same spirit as `lib/roi.ts::radialRulerForPeak`'s own
 *  default, using the payload's own resolution since a freehand draw has no
 *  peak to borrow a `gridCell` from. */
function rulerDefaultWidth(payload: MapPayload): number {
  return ((cellSize(payload.xAxis) + cellSize(payload.yAxis)) / 2) * 3;
}

type DragKind = "draw" | "move" | "resize";

interface DragState {
  kind: DragKind;
  hit: RoiHit;
  startPx: [number, number];
  startData: { x: number; y: number };
  baseRuler: RoiRuler;
  /** The RAW store value before this gesture started — restored verbatim on
   *  cancel/Esc/leave/sub-3px click, same contract as useMapRoi.ts's own
   *  `preGesture`. */
  preGesture: RoiRuler | null;
}

export interface UseMapRulerState {
  mode: RulerMode;
  setMode: (m: RulerMode) => void;
  /** The ruler actually eligible to show/drag right now — null when nothing
   *  is drawn OR the stored ruler was drawn in a different space than
   *  `cutSpace` (same "no silent angular<->Q conversion" contract as
   *  useMapRoi.ts's `rect`). */
  ruler: RoiRuler | null;
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

  /** ∫x / ∫y — POST /api/rsm/box (angle from the ruler), landed via
   *  useCutLanding. */
  commitIntegrate: (axis: "x" | "y") => void;
  landingBusy: boolean;

  /** Stats glyph — POST /api/rsm/box-stats, shown inline. */
  commitStats: () => void;
  statsBusy: boolean;
  apiStats: BoxStats | null;
  statsError: string | null;
  clearStats: () => void;
}

export function useMapRuler(active: Dataset | null, cutSpace: CutSpace | null): UseMapRulerState {
  const storeRuler = useApp((s) => s.mapRuler);
  const setMapRuler = useApp((s) => s.setMapRuler);
  // Mutual exclusivity with the box — see this file's header.
  const setMapRoi = useApp((s) => s.setMapRoi);
  const { busy: landingBusy, land } = useCutLanding();

  const [mode, setModeState] = useState<RulerMode>("off");
  const [hover, setHover] = useState<RoiHit>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  const [previewAxis, setPreviewAxis] = useState<"x" | "y">("x");
  const [preview, setPreview] = useState<RoiProfile | null>(null);
  const [previewStats, setPreviewStats] = useState<RoiBoxStats | null>(null);

  const [apiStats, setApiStats] = useState<BoxStats | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const ruler: RoiRuler | null =
    storeRuler && cutSpace && storeRuler.space === cutSpace ? storeRuler : null;

  const axis1Name = String(active?.data.metadata?.["axis1_name"] ?? "Omega");
  const cols = useMemo(() => {
    if (!active || !cutSpace) return null;
    return boxColsFor(active.data, cutSpace, axis1Name);
  }, [active, cutSpace, axis1Name]);

  // Live preview — same rAF-coalescing contract as useMapRoi.ts (one compute
  // scheduled at a time, cancelled and rescheduled on every dependency
  // change, never touches the network).
  useEffect(() => {
    if (!ruler || !cols) {
      setPreview(null);
      setPreviewStats(null);
      return;
    }
    const rect = rulerToRect(ruler);
    const raf = requestAnimationFrame(() => {
      setPreview(boxProfileLocal(cols, rect, { collapse: previewAxis, angle: ruler.angle }));
      setPreviewStats(boxStatsLocal(cols, rect, { angle: ruler.angle }));
    });
    return () => cancelAnimationFrame(raf);
  }, [ruler, cols, previewAxis]);

  // A moved/resized/redrawn ruler makes any PREVIOUS backend Stats reading
  // stale — clear it (same reasoning as useMapRoi.ts).
  useEffect(() => {
    setApiStats(null);
    setStatsError(null);
  }, [ruler]);

  function cancelDrag(): void {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setActiveGestureCancel(null);
    if (d) setMapRuler(d.preGesture);
  }

  function onDown(payload: MapPayload, w: number, h: number, px: [number, number]): void {
    if (mode !== "ruler" || !cutSpace || !active) return;
    const dataPt = pxToData(payload, w, h, px[0], px[1]);
    if (!dataPt) return;
    const project = (x: number, y: number) => dataToPx(payload, w, h, x, y);
    const cornersPx = ruler ? rulerCornersPx(ruler, project) : null;
    const hitAtDown = cornersPx ? classifyRulerHit(cornersPx, { x: px[0], y: px[1] }) : null;

    let kind: DragKind;
    let hit: RoiHit;
    let baseRuler: RoiRuler;
    if (ruler && hitAtDown) {
      kind = hitAtDown.kind === "inside" ? "move" : "resize";
      hit = hitAtDown;
      baseRuler = ruler;
    } else {
      kind = "draw";
      hit = { kind: "ruler-end", index: 0 };
      baseRuler = {
        space: cutSpace,
        cx: dataPt.x,
        cy: dataPt.y,
        angle: 0,
        length: 0,
        width: rulerDefaultWidth(payload),
      };
      setMapRuler(baseRuler);
      setMapRoi(null); // a fresh ruler draw retires any live box
    }

    dragRef.current = { kind, hit, startPx: px, startData: dataPt, baseRuler, preGesture: storeRuler };
    setDragging(true);
    setActiveGestureCancel(cancelDrag);
  }

  function onMove(payload: MapPayload, w: number, h: number, px: [number, number]): void {
    if (mode !== "ruler") return;
    const d = dragRef.current;
    if (!d) {
      if (!ruler) {
        setHover(null);
        return;
      }
      const project = (x: number, y: number) => dataToPx(payload, w, h, x, y);
      const cornersPx = rulerCornersPx(ruler, project);
      setHover(cornersPx ? classifyRulerHit(cornersPx, { x: px[0], y: px[1] }) : null);
      return;
    }
    const dataPt = pxToData(payload, w, h, px[0], px[1]);
    if (!dataPt) return;
    const dx = dataPt.x - d.startData.x;
    const dy = dataPt.y - d.startData.y;
    const minLength = Math.min(cellSize(payload.xAxis), cellSize(payload.yAxis));
    const minWidth = minLength;
    setMapRuler(applyRulerDrag(d.baseRuler, d.hit, dx, dy, minLength, minWidth));
  }

  function onUp(px: [number, number]): void {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setActiveGestureCancel(null);
    if (!d) return;
    // A drag under ~3px is a click, not a gesture — discard it, same
    // convention as useMapRoi.ts's onUp.
    const dist = Math.hypot(px[0] - d.startPx[0], px[1] - d.startPx[1]);
    if (dist < 3) setMapRuler(d.preGesture);
  }

  function onLeave(): void {
    if (dragRef.current) cancelDrag();
  }

  function onKeyDown(ev: { key: string; shiftKey: boolean; preventDefault: () => void }, payload: MapPayload): void {
    if (!ruler) return;
    const dirs: Record<string, NudgeDir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    const dir = dirs[ev.key];
    if (dir) {
      ev.preventDefault();
      const cell = dir === "left" || dir === "right" ? cellSize(payload.xAxis) : cellSize(payload.yAxis);
      const step = (ev.shiftKey ? 10 : 1) * cell;
      const dx = dir === "left" ? -step : dir === "right" ? step : 0;
      const dy = dir === "down" ? -step : dir === "up" ? step : 0;
      setMapRuler({ ...ruler, cx: ruler.cx + dx, cy: ruler.cy + dy });
      return;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      setMapRuler(null);
    }
  }

  function commitIntegrate(axis: "x" | "y"): void {
    if (!active || !ruler) return;
    const body = rulerBoxBody(active.data, ruler, { collapse: axis }) as unknown as BoxCutRequest;
    void land(rsmBoxCut(body));
  }

  async function commitStats(): Promise<void> {
    if (!active || !ruler) return;
    setStatsBusy(true);
    setStatsError(null);
    try {
      const body = roiStatsBody(active.data, rulerToRect(ruler), { angle: ruler.angle }) as unknown as BoxStatsRequest;
      setApiStats(await rsmBoxStats(body));
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : "box stats failed");
    } finally {
      setStatsBusy(false);
    }
  }

  const draggingHit = dragging ? (dragRef.current?.hit ?? null) : null;
  const cursor =
    mode !== "ruler" ? "default" : draggingHit ? roiCursor(draggingHit) : hover ? roiCursor(hover) : "crosshair";

  return {
    mode,
    setMode: (m) => {
      // Disarming (or becoming unreachable) mid-drag must abort the gesture
      // the same way Esc does — never leave a half-drawn ruler behind.
      if (m !== "ruler") cancelActiveGesture();
      setModeState(m);
    },
    ruler,
    hover,
    dragging,
    cursor,
    onDown,
    onMove,
    onUp,
    onLeave,
    onKeyDown,
    remove: () => setMapRuler(null),
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
