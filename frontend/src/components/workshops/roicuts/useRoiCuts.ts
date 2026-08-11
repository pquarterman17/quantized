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
// `mapRoi`/`mapRuler`/`mapSector` are read from store/rois.ts (mapRuler only
// to gate "Save"). `mapSector` (MAIN_PLAN item 41, moved out of local
// useState) gets the same treatment as `mapRoi`: setters below are thin
// wrappers over `store.setMapSector`, so a value typed here and a drag on
// the map's wedge (`Stage/useMapSectorWedge.ts`) are the same field — see
// store/rois.ts's header for why. `effectivePhiBounds`/`sectorPreviewFor`
// are exported so that hook derives the identical true-polar bounds without
// re-deriving the center/bounds mode-select (SEAM for item 6/12, no
// useMapRoi.ts/MapRoiOverlay.tsx/useMapSectorWedge.ts in this file).

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
import type { MapSectorState } from "../../../store/rois";
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

/** Bounds actually in effect — bounds mode is already canonical;
 *  center/half-width resolves through `sectorFromCenter`. */
export function effectivePhiBounds(s: MapSectorState): { phiMin: number; phiMax: number } {
  return s.phiParam === "bounds" ? { phiMin: s.phiMin, phiMax: s.phiMax } : sectorFromCenter(s.phiCenter, s.phiHalfWidth);
}

/** `mapSector` reduced to the canonical `RoiSector` — null off the
 *  true-polar branch. Shared by this hook and `useMapSectorWedge.ts`. */
export function sectorPreviewFor(s: MapSectorState, polar: PolarBranch): RoiSector | null {
  if (polar.kind !== "q") return null;
  const { phiMin, phiMax } = effectivePhiBounds(s);
  return { qMin: Math.min(s.secMin, s.secMax), qMax: Math.max(s.secMin, s.secMax), phiMin, phiMax };
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
  const mapSector = useApp((s) => s.mapSector);
  const setMapSector = useApp((s) => s.setMapSector);
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

  // A new active dataset re-primes the sector card's defaults (full circle,
  // q-range/secondary-range from the data, bins from map_shape) — mirrors
  // useRsm.ts's "a new active dataset invalidates the current analysis".
  // `sectorMode` is deliberately left out of the patch (mirrors the old
  // local-state version, which never reset it here either) — the merge
  // setter means omitting a field simply carries its current value forward.
  // Guarded by `primedFor` (store/rois.ts) so a SECOND mount for the SAME
  // dataset — e.g. opening this panel after the wedge already primed/dragged
  // it — is a no-op, not a silent reset of a live drag; see that field's doc.
  useEffect(() => {
    if (!active || mapSector.primedFor === active.id) return;
    const ds = active.data;
    const branch = polarBranch(ds);
    const [secMin, secMax] =
      branch.kind === "q"
        ? qMagnitudeExtent(ds)
        : branch.kind === "pole"
          ? columnExtentIdx(ds, branch.axis === "x" ? 1 : 0)
          : ([0, 1] as [number, number]);
    setMapSector({
      phiParam: "bounds",
      phiCenter: 0,
      phiHalfWidth: 180,
      phiMin: 0,
      phiMax: 360,
      secMin,
      secMax,
      sectorBins: defaultSectorBins(mapShapeOf(ds)),
      primedFor: active.id,
    });
    setBoxStats(null);
    setStatsError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

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
    const { phiMin: lo, phiMax: hi } = effectivePhiBounds(mapSector);
    const { secMin, secMax, sectorBins, sectorMode } = mapSector;
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

  const sectorPreview = sectorPreviewFor(mapSector, polar);

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

    phiParam: mapSector.phiParam,
    setPhiParam: (phiParam) => setMapSector({ phiParam }),
    phiCenter: mapSector.phiCenter,
    setPhiCenter: (phiCenter) => setMapSector({ phiCenter }),
    phiHalfWidth: mapSector.phiHalfWidth,
    setPhiHalfWidth: (phiHalfWidth) => setMapSector({ phiHalfWidth }),
    phiMin: mapSector.phiMin,
    setPhiMin: (phiMin) => setMapSector({ phiMin }),
    phiMax: mapSector.phiMax,
    setPhiMax: (phiMax) => setMapSector({ phiMax }),
    secMin: mapSector.secMin,
    setSecMin: (secMin) => setMapSector({ secMin }),
    secMax: mapSector.secMax,
    setSecMax: (secMax) => setMapSector({ secMax }),
    sectorBins: mapSector.sectorBins,
    setSectorBins: (sectorBins) => setMapSector({ sectorBins }),
    sectorMode: mapSector.sectorMode,
    setSectorMode: (sectorMode) => setMapSector({ sectorMode }),
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
