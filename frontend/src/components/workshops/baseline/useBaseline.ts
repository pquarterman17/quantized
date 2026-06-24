// Baseline workshop — state hook. Estimates a slowly-varying background under the
// active dataset's first channel via /api/baseline (ALS / rolling-ball / modpoly /
// SNIP), overlays it on the plot, and can subtract it into a new dataset. The
// estimators are golden vs MATLAB in calc.baseline; this hook is just orchestration.

import { useEffect, useState } from "react";

import {
  baselineALS,
  baselineEstimate,
  baselineModPoly,
  baselineRollingBall,
} from "../../../lib/api";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export type BaselineMethod = "als" | "rollingball" | "modpoly" | "snip";

/** Per-method tuning knobs (only the relevant subset is shown for each method). */
export interface BaselineParams {
  lam: number; // ALS smoothness (λ)
  p: number; // ALS asymmetry
  radius: number; // rolling-ball radius
  order: number; // modpoly polynomial order
  maxWindowDeg: number; // SNIP clipping window
}

const DEFAULTS: BaselineParams = { lam: 1e6, p: 0.01, radius: 100, order: 5, maxWindowDeg: 2.0 };

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
  subtract: () => void;
  clear: () => void;
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
  }
}

export function useBaseline(): BaselineState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const setBaselineOverlay = useApp((s) => s.setBaselineOverlay);
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

  async function compute(): Promise<void> {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const x = active.data.time;
      const y = active.data.values.map((row) => row[0]);
      const res = await callBaseline(method, x, y, params);
      setBaseline(res.baseline);
      setBaselineOverlay({ datasetId: active.id, y: res.baseline });
    } catch (e) {
      setError(e instanceof Error ? e.message : "baseline failed");
    } finally {
      setBusy(false);
    }
  }

  function subtract(): void {
    if (!active || !baseline) return;
    const src = active.data;
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
    const stem = active.name.replace(/\.[^.]+$/, "");
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
  };
}
