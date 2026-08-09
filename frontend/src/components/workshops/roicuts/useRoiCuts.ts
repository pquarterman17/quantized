// ROI cuts workshop — state hook (RSM_CUTS_PLAN item 8). The NUMERIC-ONLY
// entry point for box/sector cuts on a 2-D map: every action here works
// without ever touching the canvas (draw/drag/live-preview/inline-commit are
// item 6/7's job, over `store.mapRoi`/`store.mapRuler` — the SAME fields
// this hook edits, so a box typed here and a box drawn on the map are
// literally one value; no syncing effect is needed or added). Orchestration
// only: the geometry/hit-test/request-shaping primitives live in lib/roi.ts,
// the math lives in the backend calc/ modules, and landing a result in the
// library goes through the shared Stage/useCutLanding.ts hook (item 8 also
// extracted that out of useMapCuts.ts so box/sector cuts, line cuts, and
// item 6's canvas commits all share ONE addDataset/setStatus/error path).
//
// Polar routing (Resolved decisions, "polar-space rule"): the Sector card's
// "Radial profile" / "Azimuthal profile" buttons (`runSector`/`runChi`) pick
// ONE of three branches per the ACTIVE dataset's own axes, computed by the
// exported `polarBranch` below (also unit-testable on its own):
//   (i)   Qx/Qz columns present -> true polar: POST /api/rsm/sector and
//         /api/rsm/chi-profile (calc.sectorcut) directly.
//   (ii)  no Q, but a native azimuthal axis (Phi/Psi/Chi spanning >=350deg,
//         `lib/roi.ts::polefigAxes`) -> the SAME two buttons instead drive
//         POST /api/rsm/box with `wrap` set to the periodic axis (the
//         resolved decision's "box machinery with a periodic axis") — a
//         synthetic RoiRect is built from the sector card's own phi/secondary
//         fields and shaped through the EXISTING `roiBoxBody` (never a third,
//         inline request shape).
//   (iii) neither -> both buttons stay disabled; `polar.reason` is the
//         tooltip text the panel shows, never a silent no-op.
// `mapRoi`/`mapRuler` are read from store/rois.ts (not owned/edited here
// beyond mapRoi's bounds — mapRuler is read only to gate "Save").
//
// SEAM for item 6 (not built by this item, per RSM_CUTS_PLAN's file-
// ownership rule — no useMapRoi.ts/MapRoiOverlay.tsx here): `sectorPreview`
// is exposed purely so a future map overlay can render the true-polar wedge
// this card's fields describe; it is null outside branch (i) since branch
// (ii)/(iii) have no wedge to draw (branch (ii)'s preview, if any, is just
// `mapRoi`-shaped and would reuse the box overlay item 6 already builds).

import { useEffect, useState } from "react";

import { rsmBoxCut, rsmBoxStats, rsmChiProfile, rsmSector, type BoxCutRequest, type BoxStats, type BoxStatsRequest } from "../../../lib/api/rsm";
import type { CutSpace } from "../../../lib/mapcuts";
import { hasQSpace, is2DMap } from "../../../lib/mapdata";
import {
  defaultSectorBins,
  normalizeRect,
  polefigAxes,
  roiBoxBody,
  roiStatsBody,
  sectorFromCenter,
  type RoiDef,
  type RoiRect,
  type RoiSector,
} from "../../../lib/roi";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { useCutLanding } from "../../Stage/useCutLanding";

// ── Pure helpers (column extents, polar-branch detection) ──────────────────

function columnExtentIdx(ds: DataStruct, idx: number): [number, number] {
  if (idx < 0) return [0, 1];
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of ds.values) {
    const v = row[idx];
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

function columnExtent(ds: DataStruct, label: string): [number, number] {
  return columnExtentIdx(ds, ds.labels.indexOf(label));
}

/** |Q| range across every finite (Qx, Qz) pair — the true-polar sector
 *  card's default q-range (Resolved decisions: "q-range from data"). */
function qMagnitudeExtent(ds: DataStruct): [number, number] {
  const qxIdx = ds.labels.indexOf("Qx");
  const qzIdx = ds.labels.indexOf("Qz");
  if (qxIdx < 0 || qzIdx < 0) return [0, 1];
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of ds.values) {
    const qx = row[qxIdx];
    const qz = row[qzIdx];
    if (Number.isFinite(qx) && Number.isFinite(qz)) {
      const mag = Math.hypot(qx, qz);
      if (mag < lo) lo = mag;
      if (mag > hi) hi = mag;
    }
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

function mapShapeOf(ds: DataStruct): number[] | undefined {
  const v = ds.metadata?.map_shape;
  return Array.isArray(v) ? (v as number[]) : undefined;
}

/** A full-extent default box in `space`, from the dataset's OWN columns —
 *  Qx/Qz for "q"; otherwise the two axis columns every `is2D` dataset (RSM
 *  mesh/cloud/coupled OR pole figure) carries at labels[0]/[1] (2Theta+axis1,
 *  or Phi+Psi — the XRDML parser always puts the two map axes first, so this
 *  never has to name "2Theta" specifically and works for a pole figure too). */
function defaultRectFor(ds: DataStruct, space: CutSpace): RoiRect {
  if (space === "q" && hasQSpace(ds.labels)) {
    const [x0, x1] = columnExtent(ds, "Qx");
    const [y0, y1] = columnExtent(ds, "Qz");
    return { space, x0, x1, y0, y1 };
  }
  const [x0, x1] = columnExtentIdx(ds, 0);
  const [y0, y1] = columnExtentIdx(ds, 1);
  return { space: "angular", x0, x1, y0, y1 };
}

export type PolarBranch =
  | { kind: "q" }
  | { kind: "pole"; axis: "x" | "y" }
  | { kind: "none"; reason: string };

/** The three-branch polar-space rule (Resolved decisions), decided from the
 *  ACTIVE dataset alone (never the canvas's current channel picks — this
 *  hook has no view into those, by design: the numeric path must work
 *  without touching the map). Exported for direct unit testing. */
export function polarBranch(ds: DataStruct): PolarBranch {
  if (hasQSpace(ds.labels)) return { kind: "q" };
  if (ds.labels.length < 2) {
    return { kind: "none", reason: "dataset has fewer than two axis columns" };
  }
  const xSpan = (() => {
    const [lo, hi] = columnExtentIdx(ds, 0);
    return hi - lo;
  })();
  const ySpan = (() => {
    const [lo, hi] = columnExtentIdx(ds, 1);
    return hi - lo;
  })();
  const axis = polefigAxes({ label: ds.labels[0] ?? "", span: xSpan }, { label: ds.labels[1] ?? "", span: ySpan });
  if (axis) return { kind: "pole", axis };
  return {
    kind: "none",
    reason:
      "2θ/ω axes mix different physical meanings (no shared radius) — polar operations need Qx/Qz columns or a pole-figure φ/ψ axis pair",
  };
}

/** Build the periodic-axis box (branch ii) from the sector card's own
 *  phi/secondary fields, reusing `roiBoxBody` — never a third inline
 *  request shape. `phiLo`/`phiHi` are passed through UNSORTED on purpose:
 *  a wrap range (e.g. 170 -> -170, crossing the +-180 seam) is a valid,
 *  intentional selection the backend's `wrap_mask` rebase understands; only
 *  the non-periodic secondary axis gets sorted. */
function poleBoxRect(axis: "x" | "y", phiLo: number, phiHi: number, secLo: number, secHi: number): RoiRect {
  const secMin = Math.min(secLo, secHi);
  const secMax = Math.max(secLo, secHi);
  return axis === "x"
    ? { space: "angular", x0: phiLo, x1: phiHi, y0: secMin, y1: secMax }
    : { space: "angular", x0: secMin, x1: secMax, y0: phiLo, y1: phiHi };
}

/** Which box `collapse` axis produces the requested profile direction, given
 *  which axis (x or y) is the periodic phi-like one: "azimuthal" must NOT
 *  collapse away phi (the profile's domain), "radial" collapses phi itself
 *  (leaving the secondary/tilt axis as the domain — see the module header's
 *  branch (ii) description). */
function collapseFor(kind: "radial" | "azimuthal", axis: "x" | "y"): "x" | "y" {
  if (kind === "azimuthal") return axis === "x" ? "y" : "x";
  return axis;
}

// ── The hook ─────────────────────────────────────────────────────────────

export interface RoiCutsState {
  active: Dataset | null;
  isMap: boolean;
  qAvailable: boolean;
  polar: PolarBranch;
  busy: boolean;

  // Box card
  boxRect: RoiRect | null;
  boxSpace: CutSpace;
  setBoxSpace: (space: CutSpace) => void;
  setBoxX0: (v: number) => void;
  setBoxX1: (v: number) => void;
  setBoxY0: (v: number) => void;
  setBoxY1: (v: number) => void;
  boxCollapse: "x" | "y";
  setBoxCollapse: (c: "x" | "y") => void;
  boxReduce: "sum" | "mean" | "max";
  setBoxReduce: (r: "sum" | "mean" | "max") => void;
  boxBins: number;
  setBoxBins: (n: number) => void;
  runBox: (collapse?: "x" | "y") => void;
  runStats: () => Promise<void>;
  boxStats: BoxStats | null;
  statsBusy: boolean;
  statsError: string | null;

  // Sector card (also drives the pole-figure box-routed branch)
  phiParam: "center" | "bounds";
  setPhiParam: (mode: "center" | "bounds") => void;
  phiCenter: number;
  setPhiCenter: (v: number) => void;
  phiHalfWidth: number;
  setPhiHalfWidth: (v: number) => void;
  phiMin: number;
  setPhiMin: (v: number) => void;
  phiMax: number;
  setPhiMax: (v: number) => void;
  secMin: number;
  setSecMin: (v: number) => void;
  secMax: number;
  setSecMax: (v: number) => void;
  sectorBins: number;
  setSectorBins: (n: number) => void;
  sectorMode: "sum" | "mean";
  setSectorMode: (m: "sum" | "mean") => void;
  sectorPreview: RoiSector | null;
  runSector: () => void;
  runChi: () => void;

  // Saved ROIs
  savedRois: RoiDef[];
  canSaveCurrent: boolean;
  saveCurrentRoi: (name: string) => string | null;
  applySaved: (id: string) => void;
  removeSaved: (id: string) => void;

  selectedIds: string[];
}

export function useRoiCuts(): RoiCutsState {
  const active = useActiveDataset();
  const selectedIds = useApp((s) => s.selectedIds);
  const mapRoi = useApp((s) => s.mapRoi);
  const setMapRoi = useApp((s) => s.setMapRoi);
  const mapRuler = useApp((s) => s.mapRuler);
  const savedRois = useApp((s) => s.savedRois);
  const saveRoi = useApp((s) => s.saveRoi);
  const applySavedRoi = useApp((s) => s.applySavedRoi);
  const removeSavedRoi = useApp((s) => s.removeSavedRoi);
  const { busy, land } = useCutLanding();

  const isMap = active ? is2DMap(active.data) : false;
  const qAvailable = active ? hasQSpace(active.data.labels) : false;
  const polar: PolarBranch = active
    ? polarBranch(active.data)
    : { kind: "none", reason: "no active dataset" };

  // Box card local state.
  const [boxSpaceDefault, setBoxSpaceDefault] = useState<CutSpace>("angular");
  const [boxCollapse, setBoxCollapse] = useState<"x" | "y">("x");
  const [boxReduce, setBoxReduce] = useState<"sum" | "mean" | "max">("sum");
  const [boxBins, setBoxBins] = useState(200);
  const [boxStats, setBoxStats] = useState<BoxStats | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const boxSpace: CutSpace = mapRoi?.space ?? boxSpaceDefault;

  // Sector card local state.
  const [phiParam, setPhiParam] = useState<"center" | "bounds">("bounds");
  const [phiCenter, setPhiCenter] = useState(0);
  const [phiHalfWidth, setPhiHalfWidth] = useState(180);
  const [phiMin, setPhiMin] = useState(0);
  const [phiMax, setPhiMax] = useState(360);
  const [secMin, setSecMin] = useState(0);
  const [secMax, setSecMax] = useState(1);
  const [sectorBins, setSectorBins] = useState(100);
  const [sectorMode, setSectorMode] = useState<"sum" | "mean">("sum");

  // A new active dataset re-primes the sector card's defaults (full circle,
  // q-range/secondary-range from the data, bins from map_shape) — mirrors
  // useRsm.ts's "a new active dataset invalidates the current analysis".
  useEffect(() => {
    if (!active) return;
    const ds = active.data;
    setSectorBins(defaultSectorBins(mapShapeOf(ds)));
    setPhiParam("bounds");
    setPhiMin(0);
    setPhiMax(360);
    setPhiCenter(0);
    setPhiHalfWidth(180);
    const branch = polarBranch(ds);
    if (branch.kind === "q") {
      const [lo, hi] = qMagnitudeExtent(ds);
      setSecMin(lo);
      setSecMax(hi);
    } else if (branch.kind === "pole") {
      const [lo, hi] = columnExtentIdx(ds, branch.axis === "x" ? 1 : 0);
      setSecMin(lo);
      setSecMax(hi);
    } else {
      setSecMin(0);
      setSecMax(1);
    }
    setBoxStats(null);
    setStatsError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  function effectivePhiBounds(): { phiMin: number; phiMax: number } {
    return phiParam === "bounds" ? { phiMin, phiMax } : sectorFromCenter(phiCenter, phiHalfWidth);
  }

  // ── Box card actions ──────────────────────────────────────────────────

  function ensureRect(patch: Partial<RoiRect>): RoiRect | null {
    if (!active) return null;
    const base = mapRoi ?? defaultRectFor(active.data, boxSpaceDefault);
    return { ...base, ...patch };
  }
  function setBoxX0(v: number): void {
    const r = ensureRect({ x0: v });
    if (r) setMapRoi(r);
  }
  function setBoxX1(v: number): void {
    const r = ensureRect({ x1: v });
    if (r) setMapRoi(r);
  }
  function setBoxY0(v: number): void {
    const r = ensureRect({ y0: v });
    if (r) setMapRoi(r);
  }
  function setBoxY1(v: number): void {
    const r = ensureRect({ y1: v });
    if (r) setMapRoi(r);
  }
  function setBoxSpace(space: CutSpace): void {
    setBoxSpaceDefault(space);
    // Switching space always starts a FRESH full-extent box in that space —
    // never silently reinterprets the old numbers in new units (Resolved
    // decisions: "no silent angular<->Q conversion").
    if (active) setMapRoi(defaultRectFor(active.data, space));
  }

  function runBox(collapse: "x" | "y" = boxCollapse): void {
    if (!active || !mapRoi) return;
    const body = roiBoxBody(active.data, normalizeRect(mapRoi), {
      collapse,
      reduce: boxReduce,
      nBins: boxBins,
    }) as unknown as BoxCutRequest;
    void land(rsmBoxCut(body));
  }

  async function runStats(): Promise<void> {
    if (!active || !mapRoi) return;
    setStatsBusy(true);
    setStatsError(null);
    try {
      const body = roiStatsBody(active.data, normalizeRect(mapRoi)) as unknown as BoxStatsRequest;
      setBoxStats(await rsmBoxStats(body));
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : "box stats failed");
    } finally {
      setStatsBusy(false);
    }
  }

  // ── Sector card actions (polar routing) ──────────────────────────────

  function runProfile(kind: "radial" | "azimuthal"): void {
    if (!active) return;
    const branch = polarBranch(active.data);
    const { phiMin: lo, phiMax: hi } = effectivePhiBounds();
    if (branch.kind === "q") {
      const req = {
        dataset: active.data,
        q_min: Math.min(secMin, secMax),
        q_max: Math.max(secMin, secMax),
        n_bins: sectorBins,
        mode: sectorMode,
        phi_min: lo,
        phi_max: hi,
      };
      void land(kind === "radial" ? rsmSector(req) : rsmChiProfile(req));
    } else if (branch.kind === "pole") {
      const rect = poleBoxRect(branch.axis, lo, hi, secMin, secMax);
      const body = roiBoxBody(active.data, rect, {
        collapse: collapseFor(kind, branch.axis),
        reduce: sectorMode,
        nBins: sectorBins,
        wrap: branch.axis,
      }) as unknown as BoxCutRequest;
      void land(rsmBoxCut(body));
    }
    // branch "none": the panel disables both buttons — no-op guard here too.
  }
  const runSector = (): void => runProfile("radial");
  const runChi = (): void => runProfile("azimuthal");

  const { phiMin: previewPhiMin, phiMax: previewPhiMax } = effectivePhiBounds();
  const sectorPreview: RoiSector | null =
    polar.kind === "q"
      ? {
          qMin: Math.min(secMin, secMax),
          qMax: Math.max(secMin, secMax),
          phiMin: previewPhiMin,
          phiMax: previewPhiMax,
        }
      : null;

  // ── Saved ROIs ────────────────────────────────────────────────────────

  const canSaveCurrent = !!mapRoi || !!mapRuler;
  function saveCurrentRoi(name: string): string | null {
    return saveRoi(name);
  }
  function applySaved(id: string): void {
    applySavedRoi(id);
  }
  function removeSaved(id: string): void {
    removeSavedRoi(id);
  }

  return {
    active,
    isMap,
    qAvailable,
    polar,
    busy,

    boxRect: mapRoi,
    boxSpace,
    setBoxSpace,
    setBoxX0,
    setBoxX1,
    setBoxY0,
    setBoxY1,
    boxCollapse,
    setBoxCollapse,
    boxReduce,
    setBoxReduce,
    boxBins,
    setBoxBins,
    runBox,
    runStats,
    boxStats,
    statsBusy,
    statsError,

    phiParam,
    setPhiParam,
    phiCenter,
    setPhiCenter,
    phiHalfWidth,
    setPhiHalfWidth,
    phiMin,
    setPhiMin,
    phiMax,
    setPhiMax,
    secMin,
    setSecMin,
    secMax,
    setSecMax,
    sectorBins,
    setSectorBins,
    sectorMode,
    setSectorMode,
    sectorPreview,
    runSector,
    runChi,

    savedRois,
    canSaveCurrent,
    saveCurrentRoi,
    applySaved,
    removeSaved,

    selectedIds,
  };
}
