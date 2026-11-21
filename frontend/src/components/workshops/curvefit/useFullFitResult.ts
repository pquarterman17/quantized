// Curve Fit -- a section's view of the fit at FULL resolution (P4 phase 2,
// lib/fitCurve.ts). A large fit's result is a display curve: no `yFit`, no
// `residuals`. A section that needs them (residual plots, the fit report)
// asks here, and only while it is open, so a fit nobody inspects never pulls
// its full curve over the wire. Any other result is returned as is, at once.

import { useEffect, useState } from "react";

import { curveSourceOf, fullFitResult } from "../../../lib/fitCurve";
import type { CalcResult } from "../../../lib/types";

export interface FullFitResult {
  /** The result with `yFit` + `residuals`; null while loading or idle. */
  result: CalcResult | null;
  loading: boolean;
  error: string | null;
}

export function useFullFitResult(result: CalcResult, y: readonly number[], active: boolean): FullFitResult {
  const display = curveSourceOf(result) != null;
  const [state, setState] = useState<{ of: CalcResult; full: CalcResult | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!display || !active) return;
    let live = true;
    fullFitResult(result, y)
      .then((full) => live && setState({ of: result, full, error: null }))
      .catch((e: unknown) => live && setState({ of: result, full: null, error: e instanceof Error ? e.message : "could not load the full fit curve" }));
    return () => {
      live = false;
    };
  }, [display, active, result, y]);
  if (!display) return { result, loading: false, error: null };
  const mine = state?.of === result ? state : null;
  return { result: mine?.full ?? null, loading: active && !mine, error: mine?.error ?? null };
}
