// Sector-wedge gesture state machine (RSM_CUTS_PLAN item 12, Tier 3):
// draggable qMin/qMax radial-arc handles, phiMin/phiMax angular-edge
// handles, and an interior rotate — over the sector the ROI cuts panel's
// Sector card already defines (workshops/roicuts/useRoiCuts.ts). Explicitly
// an ADDITION, not a replacement: this hook never DRAWS a sector from
// nothing (a click that misses every handle/interior is a no-op — see
// `onDown`) — the panel's numeric fields stay the authoritative way to
// first define one and to repeat a cut across datasets, exactly as the
// plan's task brief for this item specifies. Structurally the same
// draw-less handle/interior -> idle shape as useMapRoi.ts/useMapRuler.ts:
// px<->data via pxToData/dataToPx, Esc-abort via gestureCancel, rAF-
// coalesced client preview via lib/roiMath.ts (never the commit path), and
// a sub-3px release discarded as a click.
//
// STATE OWNERSHIP (MAIN_PLAN item 41): the sector's authoritative fields
// live in `store.mapSector` (RoisSlice, store/rois.ts) — the box/ruler's
// own `store.mapRoi`/`store.mapRuler` pattern, now applied here too.
// `writeSector` below reads/writes it directly via `useApp`, so a drag here
// and a numeric edit in a separately-mounted `RoiCutsPanel` are the SAME
// store field, in sync for free — no second `useRoiCuts()` instance is
// needed to reach the state anymore (that indirection, and the cross-
// instance gap it left, only existed while the state was local; see
// store/rois.ts's header for the fix this replaces). `rc = useRoiCuts()`
// below is kept for exactly one thing: `runSector`/`runChi`/`busy`, the SAME
// request-shaping + landing logic the panel's own buttons call — not for
// its state, which this hook no longer reads.

import { useEffect, useMemo, useRef, useState } from "react";

import { cancelActiveGesture, setActiveGestureCancel } from "../../lib/gestureCancel";
import type { CutSpace } from "../../lib/mapcuts";
import { rsmAxisKeys, type MapPayload } from "../../lib/mapdataFetch";
import type { RoiSector } from "../../lib/roi";
import { applySectorDrag, classifySectorHit, pymod, sectorCursor, type SectorHit } from "../../lib/roiSector";
import { chiProfileLocal, sectorProfileLocal, type PolarCols, type RoiProfile } from "../../lib/roiMath";
import type { Dataset, DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import type { MapSectorState } from "../../store/rois";
import { sectorPreviewFor, useRoiCuts } from "../workshops/roicuts/useRoiCuts";
import type { WedgeMode } from "./MapToolbar";
import { plotRect } from "./mapRender";
import { pxToData } from "./useMapRoi";

const RAD2DEG = 180 / Math.PI;

/** Flat Qx/Qz/Intensity columns for the active dataset — mirrors
 *  `useMapRoi.ts::boxColsFor`'s shape (a caller-picked column set, plain
 *  Float64Arrays over data already loaded client-side), simplified since the
 *  wedge is Q-space-only (no axis1Name/map_shape branch to consider). Reuses
 *  `rsmAxisKeys` (the SAME column-picking rule `boxColsFor`/`MapStage.tsx`
 *  use) rather than a third hand-rolled `labels.indexOf`. */
function polarColsFor(ds: DataStruct): PolarCols | null {
  const keys = rsmAxisKeys(ds.labels, "", "q");
  if (!keys) return null;
  const [qxi, qzi, zi] = keys;
  const n = ds.values.length;
  const qx = new Float64Array(n);
  const qz = new Float64Array(n);
  const intensity = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = ds.values[i]!;
    qx[i] = row[qxi]!;
    qz[i] = row[qzi]!;
    intensity[i] = row[zi]!;
  }
  return { qx, qz, intensity };
}

/** Uniform data->px scale for the CURRENTLY DISPLAYED axes — only meaningful
 *  (and only ever called) when `cutSpace === "q"`, where `plotRect` LOCKS
 *  equal aspect (`lib/mapAspect.ts`, item 17), so a single scalar applies to
 *  both axes exactly (see `lib/roiSector.ts`'s header for why that is what
 *  makes the polar hit-test valid). */
function qPxScale(payload: MapPayload, w: number, h: number): number {
  const rect = plotRect(payload, w, h);
  const xSpan = Math.abs(payload.xAxis[payload.xAxis.length - 1]! - payload.xAxis[0]!);
  return xSpan > 0 ? rect.w / xSpan : 1;
}

/** Write a dragged `RoiSector` back into `store.mapSector` — `secMin`/
 *  `secMax` always directly; `phiMin`/`phiMax` directly in "bounds" mode, or
 *  re-derived into `phiCenter`/`phiHalfWidth` in "center" mode via the
 *  sector's own SPAN (not a naive `(max-min)/2`, which goes negative the
 *  instant `phiMax` is stored numerically less than `phiMin` — e.g. right
 *  after a phiMax-handle drag past the seam) so a wrap-crossing result still
 *  derives a correct, non-negative half-width. */
function writeSector(current: MapSectorState, setMapSector: (patch: Partial<MapSectorState>) => void, next: RoiSector): void {
  if (current.phiParam === "bounds") {
    setMapSector({ secMin: next.qMin, secMax: next.qMax, phiMin: next.phiMin, phiMax: next.phiMax });
  } else {
    const span = pymod(next.phiMax - next.phiMin, 360) || 360;
    setMapSector({ secMin: next.qMin, secMax: next.qMax, phiCenter: next.phiMin + span / 2, phiHalfWidth: span / 2 });
  }
}

interface DragState {
  hit: Exclude<SectorHit, null>;
  startPx: [number, number];
  /** Pointer azimuth (deg) at gesture start — the "interior" rotate's delta
   *  reference (see `lib/roiSector.ts::applySectorDrag`'s doc). */
  startPhi: number;
  baseSector: RoiSector;
  /** The RAW sector before this gesture started — restored verbatim on
   *  cancel/Esc/leave/sub-3px click, same contract as useMapRoi.ts's/
   *  useMapRuler.ts's own `preGesture`. */
  preGesture: RoiSector;
}

export interface UseMapSectorWedgeState {
  mode: WedgeMode;
  setMode: (m: WedgeMode) => void;
  /** The sector actually eligible to show/drag right now — null off the
   *  true-polar branch (no Qx/Qz) OR when the displayed axes aren't Q
   *  (Resolved decisions: the wedge is Q-space only; hidden, not silently
   *  inert, on an angular view). */
  sector: RoiSector | null;
  hover: SectorHit;
  dragging: boolean;
  cursor: string;

  onDown: (payload: MapPayload, w: number, h: number, px: [number, number]) => void;
  onMove: (payload: MapPayload, w: number, h: number, px: [number, number]) => void;
  onUp: (px: [number, number]) => void;
  onLeave: () => void;

  /** Client preview (lib/roiMath.ts), rAF-coalesced — LOCAL to this hook,
   *  never written to the store, never landed. */
  preview: RoiProfile | null;
  previewAxis: "q" | "phi";
  setPreviewAxis: (axis: "q" | "phi") => void;

  /** Radial/Azimuthal — POST /api/rsm/sector · /chi-profile via the SAME
   *  `useRoiCuts().runSector`/`runChi` the panel's own buttons call (no
   *  second request-shaping path). */
  runRadial: () => void;
  runAzimuthal: () => void;
  busy: boolean;
}

export function useMapSectorWedge(active: Dataset | null, cutSpace: CutSpace | null): UseMapSectorWedgeState {
  const rc = useRoiCuts();
  const mapSector = useApp((s) => s.mapSector);
  const setMapSector = useApp((s) => s.setMapSector);

  const [mode, setModeState] = useState<WedgeMode>("off");
  const [hover, setHover] = useState<SectorHit>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const [previewAxis, setPreviewAxis] = useState<"q" | "phi">("q");
  const [preview, setPreview] = useState<RoiProfile | null>(null);

  // Only shown/draggable over the CURRENTLY DISPLAYED Q axes — `rc.polar`
  // is about the ACTIVE DATASET's capability (Qx/Qz present at all), not
  // which axes are on screen right now (mirrors useMapRoi.ts's `rect`
  // space-mismatch gate). Read from `rc`, not re-derived from this hook's
  // own `active` param, so a bound-panel dataset (MapStage's `dataset`
  // prop) can never disagree with the panel's own polar-branch gate.
  const sector: RoiSector | null = cutSpace === "q" ? sectorPreviewFor(mapSector, rc.polar) : null;

  const cols = useMemo(() => (active ? polarColsFor(active.data) : null), [active]);

  // Live preview: rAF-coalesced, same contract as useMapRoi.ts/useMapRuler.ts
  // (one compute scheduled at a time, cancelled and rescheduled on every
  // dependency change, NEVER touches the network).
  useEffect(() => {
    if (!sector || !cols) {
      setPreview(null);
      return;
    }
    const opts = {
      qMin: sector.qMin,
      qMax: sector.qMax,
      phiMin: sector.phiMin,
      phiMax: sector.phiMax,
      nBins: mapSector.sectorBins,
      mode: mapSector.sectorMode,
    };
    const raf = requestAnimationFrame(() => {
      setPreview(previewAxis === "q" ? sectorProfileLocal(cols, opts) : chiProfileLocal(cols, opts));
    });
    return () => cancelAnimationFrame(raf);
  }, [sector, cols, previewAxis, mapSector.sectorBins, mapSector.sectorMode]);

  function cancelDrag(): void {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setActiveGestureCancel(null);
    if (d) writeSector(mapSector, setMapSector, d.preGesture);
  }

  function onDown(payload: MapPayload, w: number, h: number, px: [number, number]): void {
    if (mode !== "sector" || cutSpace !== "q" || !sector) return;
    const dataPt = pxToData(payload, w, h, px[0], px[1]);
    if (!dataPt) return;
    const hit = classifySectorHit(sector, dataPt.x, dataPt.y, qPxScale(payload, w, h));
    // A click that misses every handle/interior draws nothing — see this
    // file's header: the wedge only ADJUSTS an existing sector.
    if (!hit) return;
    const startPhi = Math.atan2(dataPt.y, dataPt.x) * RAD2DEG;
    dragRef.current = { hit, startPx: px, startPhi, baseSector: sector, preGesture: sector };
    setDragging(true);
    setActiveGestureCancel(cancelDrag);
  }

  function onMove(payload: MapPayload, w: number, h: number, px: [number, number]): void {
    if (mode !== "sector") return;
    const d = dragRef.current;
    if (!d) {
      if (!sector) {
        setHover(null);
        return;
      }
      const dataPt = pxToData(payload, w, h, px[0], px[1]);
      setHover(dataPt ? classifySectorHit(sector, dataPt.x, dataPt.y, qPxScale(payload, w, h)) : null);
      return;
    }
    const dataPt = pxToData(payload, w, h, px[0], px[1]);
    if (!dataPt) return;
    // A tiny non-zero minimum gap (not 0) keeps qMin/qMax from ever landing
    // EXACTLY on top of each other mid-drag, which would select nothing.
    const next = applySectorDrag(d.baseSector, d.hit, dataPt.x, dataPt.y, { startPhi: d.startPhi, minRadialGap: 1e-6 });
    writeSector(mapSector, setMapSector, next);
  }

  function onUp(px: [number, number]): void {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setActiveGestureCancel(null);
    if (!d) return;
    // A drag under ~3px is a click, not a gesture — discard it, same
    // convention as useMapRoi.ts's/useMapRuler.ts's own onUp.
    const dist = Math.hypot(px[0] - d.startPx[0], px[1] - d.startPx[1]);
    if (dist < 3) writeSector(mapSector, setMapSector, d.preGesture);
  }

  function onLeave(): void {
    // Mirrors useMapRoi.ts/useMapRuler.ts: leaving the canvas mid-gesture
    // aborts it (same effect as Esc), never commits.
    if (dragRef.current) cancelDrag();
  }

  const draggingHit = dragging ? (dragRef.current?.hit ?? null) : null;
  const cursor = mode !== "sector" ? "default" : draggingHit ? sectorCursor(draggingHit) : sectorCursor(hover);

  return {
    mode,
    setMode: (m) => {
      // Disarming (or becoming unreachable) mid-drag must abort the gesture
      // the same way Esc does — never leave a half-dragged sector behind.
      if (m !== "sector") cancelActiveGesture();
      setModeState(m);
    },
    sector,
    hover,
    dragging,
    cursor,
    onDown,
    onMove,
    onUp,
    onLeave,
    preview,
    previewAxis,
    setPreviewAxis,
    runRadial: rc.runSector,
    runAzimuthal: rc.runChi,
    busy: rc.busy,
  };
}
