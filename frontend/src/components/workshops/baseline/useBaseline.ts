// Baseline workshop — state hook. Estimates a slowly-varying background under the
// active dataset's first channel via /api/baseline (ALS / rolling-ball / modpoly /
// SNIP / anchors / Shirley / XRD low-angle / analytic polynomials), overlays it on
// the plot, and can subtract it into a new dataset. The GOTO #2 anchor method is
// interactive: clicks on the plot place/move/remove anchors (store bridge →
// anchorEditPlugin), the preview re-estimates debounced, and Apply subtracts
// through the store's applyCorrections chokepoint (bgAnchors params) so it rides
// the same step-executor/recalc-DAG path as every other correction — no parallel
// pipeline. The estimators are golden vs MATLAB in calc.baseline (the GOTO
// additions are reference-value tested); this hook is just orchestration.

import { useEffect, useRef, useState } from "react";

import {
  baselineALS,
  baselineAnchor,
  baselineEstimate,
  baselineModPoly,
  baselineRegion,
  baselineRollingBall,
  baselineShirley,
  baselineXrdLowAngle,
} from "../../../lib/api";
import type { CorrectionParams, Dataset, DataStruct } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export type BaselineMethod =
  | "als"
  | "rollingball"
  | "modpoly"
  | "snip"
  | "region"
  | "anchor"
  | "shirley"
  | "xrdla"
  | "linear"
  | "quadratic"
  | "poly";

/** Per-method tuning knobs (only the relevant subset is shown for each method). */
export interface BaselineParams {
  lam: number; // ALS smoothness (λ)
  p: number; // ALS asymmetry
  radius: number; // rolling-ball radius
  order: number; // modpoly / region / poly-n polynomial order
  maxWindowDeg: number; // SNIP clipping window
  regionXMin: number; // region: box left edge (NaN -> data min)
  regionXMax: number; // region: box right edge (NaN -> data max)
  maxIter: number; // Shirley iteration cap
  anchorMethod: string; // anchor interpolation: linear | pchip | spline
}

const DEFAULTS: BaselineParams = {
  lam: 1e6, p: 0.01, radius: 100, order: 5, maxWindowDeg: 2.0,
  regionXMin: Number.NaN, regionXMax: Number.NaN,
  maxIter: 50, anchorMethod: "pchip",
};

let _subCounter = 0;

export interface BaselineState {
  active: Dataset | null;
  method: BaselineMethod;
  params: BaselineParams;
  baseline: (number | null)[] | null;
  busy: boolean;
  error: string | null;
  /** Anchor method (#2): the picked (x, y) anchors, in click order. */
  anchors: [number, number][];
  setMethod: (m: BaselineMethod) => void;
  setParams: (patch: Partial<BaselineParams>) => void;
  compute: () => Promise<void>;
  subtract: () => Promise<void>;
  clear: () => void;
  /** Arm the plot's rubber-band so the next drag fills the region box edges. */
  pickRegion: () => void;
  clearAnchors: () => void;
  /** Anchor method (#2): subtract via the corrections chokepoint (bgAnchors
   *  params) — records a replayable correction step + rides the recalc DAG. */
  applyAnchors: () => Promise<void>;
}

/** The full-range polynomial methods reuse the region-fit calc (#8: the
 *  BG-from-region polyfit surfaced as first-class picker choices). */
function regionOrder(method: BaselineMethod, p: BaselineParams): number {
  return method === "linear" ? 1 : method === "quadratic" ? 2 : p.order;
}

/** Dispatch to the right baseline endpoint for the chosen method. */
function callBaseline(
  method: BaselineMethod,
  x: number[],
  y: number[],
  p: BaselineParams,
  anchors: [number, number][],
): Promise<{ baseline: (number | null)[] }> {
  switch (method) {
    case "als":
      return baselineALS({ y, lam: p.lam, p: p.p });
    case "rollingball":
      return baselineRollingBall({ y, radius: p.radius });
    case "modpoly":
      return baselineModPoly({ y, order: p.order });
    case "snip":
      return baselineEstimate({ x, y, method: "snip" });
    case "anchor":
      return baselineAnchor({ x, y, anchors, method: p.anchorMethod });
    case "shirley":
      return baselineShirley({ x, y, max_iter: p.maxIter });
    case "xrdla":
      return baselineXrdLowAngle({ x, y });
    case "region":
    case "linear":
    case "quadratic":
    case "poly": {
      // Default the box to the full x-range; "region" lets the user narrow it
      // to background-only, the analytic methods (#8) always fit the full range.
      // Loop, not Math.min(...spread): spreading a 100k+-point x array as
      // call arguments throws RangeError above the engine's arity cap - and
      // the analytic methods (#8) take this path on EVERY compute.
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of x) {
        if (Number.isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      const useBox = method === "region";
      const xMin = useBox && Number.isFinite(p.regionXMin) ? p.regionXMin : lo;
      const xMax = useBox && Number.isFinite(p.regionXMax) ? p.regionXMax : hi;
      // The region endpoint returns the polynomial as `background`; adapt to `baseline`.
      return baselineRegion({ x, y, x_min: xMin, x_max: xMax, order: regionOrder(method, p) }).then(
        (r) => ({ baseline: r.background }),
      );
    }
  }
}

export function useBaseline(): BaselineState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const setBaselineOverlay = useApp((s) => s.setBaselineOverlay);
  const setPlotTool = useApp((s) => s.setPlotTool);
  const regionPicked = useApp((s) => s.regionPicked);
  const setRegionPicked = useApp((s) => s.setRegionPicked);
  const setBaselineAnchorEdit = useApp((s) => s.setBaselineAnchorEdit);
  const [method, setMethod] = useState<BaselineMethod>("als");
  const [params, setParamsState] = useState<BaselineParams>(DEFAULTS);
  const [baseline, setBaseline] = useState<(number | null)[] | null>(null);
  const [anchors, setAnchors] = useState<[number, number][]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The debounced anchor-preview effect must re-estimate with the LATEST
  // anchors without holding compute() in its dependency list (a fresh closure
  // every render would defeat the debounce) — the shared plugin-bridge idiom.
  const computeRef = useRef<() => Promise<void>>(async () => {});

  // A new active dataset invalidates the current estimate + its overlay (and
  // the anchors — they're coordinates on the OLD data).
  useEffect(() => {
    setBaseline(null);
    setError(null);
    setAnchors([]);
    setBaselineOverlay(null);
  }, [active, setBaselineOverlay]);

  const setParams = (patch: Partial<BaselineParams>): void =>
    setParamsState((p) => ({ ...p, ...patch }));

  // The plot's rubber-band writes its [x_min,x_max] to the store; pull it into
  // the box-edge params (already ordered + clamped) and consume it once.
  useEffect(() => {
    if (!regionPicked) return;
    const [lo, hi] = regionPicked;
    setParamsState((p) => ({ ...p, regionXMin: lo, regionXMax: hi }));
    setRegionPicked(null);
  }, [regionPicked, setRegionPicked]);

  const pickRegion = (): void => setPlotTool("region");

  async function compute(): Promise<void> {
    if (!active) return;
    if (method === "anchor" && anchors.length < 2) {
      setError("place at least 2 anchors on the plot");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // #38 deferred edge: never estimate a baseline against the small
      // preview — resolve the active dataset's full data first.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const x = ds.data.time;
      const y = ds.data.values.map((row) => row[0]);
      const res = await callBaseline(method, x, y, params, anchors);
      setBaseline(res.baseline);
      setBaselineOverlay({ datasetId: ds.id, y: res.baseline });
    } catch (e) {
      setError(e instanceof Error ? e.message : "baseline failed");
    } finally {
      setBusy(false);
    }
  }
  computeRef.current = compute;

  // Anchor mode (#2): publish the click/drag bridge for the plot's
  // anchorEditPlugin while the method is live; null it otherwise (the same
  // wizard-scoped bridge idiom as usePeakWizard's peakWizardEdit).
  useEffect(() => {
    if (method !== "anchor" || !active) {
      setBaselineAnchorEdit(null);
      return;
    }
    setBaselineAnchorEdit({
      anchors: anchors.map(([x, y], index) => ({ index, x, y })),
      addAnchor: (x, y) => setAnchors((a) => [...a, [x, y]]),
      moveAnchor: (index, x, y) =>
        setAnchors((a) => a.map((pt, i) => (i === index ? ([x, y] as [number, number]) : pt))),
      removeAnchor: (index) => setAnchors((a) => a.filter((_, i) => i !== index)),
    });
    return () => setBaselineAnchorEdit(null);
  }, [method, anchors, active, setBaselineAnchorEdit]);

  // Anchor mode (#2): live preview — re-estimate (debounced) as anchors are
  // placed/dragged; drop the overlay when there aren't enough anchors yet.
  useEffect(() => {
    if (method !== "anchor") return;
    if (!active || anchors.length < 2) {
      setBaseline(null);
      setBaselineOverlay(null);
      return;
    }
    const t = setTimeout(() => void computeRef.current(), 150);
    return () => clearTimeout(t);
  }, [method, anchors, params.anchorMethod, active, setBaselineOverlay]);

  async function subtract(): Promise<void> {
    if (!active || !baseline) return;
    const ds = await useApp.getState().resolveDataset(active.id);
    if (!ds) return;
    const src = ds.data;
    const values = src.values.map((row, i) => {
      const b = baseline[i];
      const next = [...row];
      if (Number.isFinite(row[0]) && b != null) next[0] = row[0] - b;
      return next;
    });
    const data: DataStruct = {
      ...src,
      values,
      metadata: { ...src.metadata, baseline_subtracted: method },
    };
    const stem = ds.name.replace(/\.[^.]+$/, "");
    addDataset({ id: `bgsub-${++_subCounter}`, name: `${stem} (bg-sub)`, data });
    setStatus(`subtracted ${method} baseline`);
  }

  // Anchor apply (#2): merge bgAnchors into the dataset's corrections and run
  // them through the store's applyCorrections — the SAME chokepoint the
  // Corrections card, the pipeline step executor, and the recalc DAG use.
  async function applyAnchors(): Promise<void> {
    if (!active || anchors.length < 2) return;
    const ds = await useApp.getState().resolveDataset(active.id);
    if (!ds) return;
    const params_: CorrectionParams = {
      ...(ds.corrections ?? {}),
      bgAnchors: anchors,
      bgAnchorMethod: params.anchorMethod,
    };
    const bg = ds.bgRef ? { datasetId: ds.bgRef.datasetId, interp: ds.bgRef.interp } : undefined;
    await useApp.getState().applyCorrections(ds.id, params_, bg);
    setBaselineOverlay(null);
    setBaseline(null);
    setAnchors([]);
    setStatus("subtracted anchor baseline (correction step)");
  }

  function clear(): void {
    setBaseline(null);
    setError(null);
    setBaselineOverlay(null);
  }

  const clearAnchors = (): void => setAnchors([]);

  return {
    active,
    method,
    params,
    baseline,
    busy,
    error,
    anchors,
    setMethod,
    setParams,
    compute,
    subtract,
    clear,
    pickRegion,
    clearAnchors,
    applyAnchors,
  };
}
