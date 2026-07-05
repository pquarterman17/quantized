// Hysteresis workshop — state hook. Runs the M-H loop analysis on the active
// dataset (H = DataStruct.time, M = first channel) via /api/magnetometry and
// surfaces the result/busy/error. Also offers a one-click linear-background
// subtract (the paramagnetic/diamagnetic high-field slope) that writes a
// corrected M-H dataset to the library. Re-runs analysis whenever the active
// (or corrected) dataset changes.

import { useEffect, useState } from "react";

import { hysteresisAnalysis, subtractHysteresisBackground } from "../../../lib/api";
import { analysisData } from "../../../lib/rowstate";
import type { CalcResult, Dataset, DataStruct } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export interface HysteresisState {
  active: Dataset | null;
  result: CalcResult | null;
  busy: boolean;
  error: string | null;
  bgBusy: boolean;
  subtractBackground: () => Promise<void>;
}

let _bgCounter = 0;

export function useHysteresis(): HysteresisState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bgBusy, setBgBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    if (!active) return;
    setBusy(true);
    // Analysis view (excluded/filtered rows dropped, #50/#53) so a masked outlier
    // point doesn't skew Hc/Mr/Ms.
    const src = analysisData(active) ?? active.data;
    const h = src.time;
    const m = src.values.map((row) => row[0]);
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

  // Subtract the linear dia/paramagnetic slope fit to the high-field tails
  // (slope only — the offset is kept so Hc/Mr are unchanged; port of MATLAB
  // subtractLinearBG). Writes an "(bg-sub)" dataset rather than mutating.
  async function subtractBackground(): Promise<void> {
    if (!active) return;
    setBgBusy(true);
    setError(null);
    try {
      const src = analysisData(active) ?? active.data;
      const h = src.time;
      const m = src.values.map((row) => row[0]);
      const res = await subtractHysteresisBackground({ h, m });
      const data: DataStruct = {
        ...active.data,
        time: h,
        values: res.corrected.map((v) => [v ?? Number.NaN]),
        labels: [active.data.labels[0] ?? "Moment"],
        units: [active.data.units[0] ?? ""],
        metadata: { ...active.data.metadata, hysteresis_bg_subtracted: true },
      };
      const stem = active.name.replace(/\.[^.]+$/, "");
      addDataset({ id: `hystbg-${++_bgCounter}`, name: `${stem} (bg-sub)`, data });
      setStatus(
        res.slope === 0
          ? "no high-field background found (too few tail points)"
          : `subtracted linear background (slope ${res.slope.toExponential(2)})`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "background subtraction failed");
    } finally {
      setBgBusy(false);
    }
  }

  return { active, result, busy, error, bgBusy, subtractBackground };
}
