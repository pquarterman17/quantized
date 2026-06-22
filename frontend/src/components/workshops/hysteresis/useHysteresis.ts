// Hysteresis workshop — state hook. Runs the M-H loop analysis on the active
// dataset (H = DataStruct.time, M = first channel) via /api/magnetometry and
// surfaces the result/busy/error. Re-runs whenever the active (or corrected)
// dataset changes.

import { useEffect, useState } from "react";

import { hysteresisAnalysis } from "../../../lib/api";
import type { CalcResult, Dataset } from "../../../lib/types";
import { useActiveDataset } from "../../../store/useApp";

export interface HysteresisState {
  active: Dataset | null;
  result: CalcResult | null;
  busy: boolean;
  error: string | null;
}

export function useHysteresis(): HysteresisState {
  const active = useActiveDataset();
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    if (!active) return;
    setBusy(true);
    const h = active.data.time;
    const m = active.data.values.map((row) => row[0]);
    hysteresisAnalysis({ h, m })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "analysis failed");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return { active, result, busy, error };
}
