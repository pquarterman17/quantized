// Baseline workshop — state hook. Estimates a slowly-varying background under the
// active dataset's first channel via /api/baseline (ALS / rolling-ball / modpoly /
// SNIP), overlays it on the plot, and can subtract it into a new dataset. The
// estimators are golden vs MATLAB in calc.baseline; this hook is just orchestration.

import { useEffect, useState } from "react";

import {
  baselineALS,
  baselineEstimate,
  baselineModPoly,
  baselineRegion,
  baselineRollingBall,
} from "../../../lib/api";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export type BaselineMethod = "als" | "rollingball" | "modpoly" | "snip" | "region";

/** Per-method tuning knobs (only the relevant subset is shown for each method). */
export interface BaselineParams {
  lam: number; // ALS smoothness (λ)
  p: number; // ALS asymmetry
  radius: number; // rolling-ball radius
  order: number; // modpoly / region polynomial order
  maxWindowDeg: number; // SNIP clipping window
  regionXMin: number; // region: box left edge (NaN -> data min)
  regionXMax: number; // region: box right edge (NaN -> data max)
}

const DEFAULTS: BaselineParams = {
  lam: 1e6, p: 0.01, radius: 100, order: 5, maxWindowDeg: 2.0,
  regionXMin: Number.NaN, regionXMax: Number.NaN,
};

let _subCounter = 0;

export interface BaselineState {
  active: Dataset | null;
  method: BaselineMethod;
  params: BaselineParams;
  baseline: (number | null)[] | null;
  busy: boolean;
  error: string | null;
  setMethod: (m: BaselineMethod) => void;
  setParams: (patch: Partial<BaselineParams>) => void;
  compute: () => Promise<void>;
  subtract: () => Promise<void>;
  clear: () => void;
  /** Arm the plot's rubber-band so the next drag fills the region box edges. */
  pickRegion: () => void;
}

/** Dispatch to the right baseline endpoint for the chosen method. */
function callBaseline(
  method: BaselineMethod,
  x: number[],
  y: number[],
  p: BaselineParams,
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
    case "region": {
      // Default the box to the full x-range; the user narrows it to background-only.
      const finite = x.filter((v) => Number.isFinite(v));
      const xMin = Number.isFinite(p.regionXMin) ? p.regionXMin : Math.min(...finite);
      const xMax = Number.isFinite(p.regionXMax) ? p.regionXMax : Math.max(...finite);
      // The region endpoint returns the polynomial as `background`; adapt to `baseline`.
      return baselineRegion({ x, y, x_min: xMin, x_max: xMax, order: p.order }).then((r) => ({
        baseline: r.background,
      }));
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
  const [method, setMethod] = useState<BaselineMethod>("als");
  const [params, setParamsState] = useState<BaselineParams>(DEFAULTS);
  const [baseline, setBaseline] = useState<(number | null)[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new active dataset invalidates the current estimate + its overlay.
  useEffect(() => {
    setBaseline(null);
    setError(null);
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
    setBusy(true);
    setError(null);
    try {
      // #38 deferred edge: never estimate a baseline against the small
      // preview — resolve the active dataset's full data first.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const x = ds.data.time;
      const y = ds.data.values.map((row) => row[0]);
      const res = await callBaseline(method, x, y, params);
      setBaseline(res.baseline);
      setBaselineOverlay({ datasetId: ds.id, y: res.baseline });
    } catch (e) {
      setError(e instanceof Error ? e.message : "baseline failed");
    } finally {
      setBusy(false);
    }
  }

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

  function clear(): void {
    setBaseline(null);
    setError(null);
    setBaselineOverlay(null);
  }

  return {
    active,
    method,
    params,
    baseline,
    busy,
    error,
    setMethod,
    setParams,
    compute,
    subtract,
    clear,
    pickRegion,
  };
}
