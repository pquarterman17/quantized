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
    const activeId = active.id;
    void (async () => {
      try {
        // #38 deferred edge: auto-analysis must never run on the small
        // preview — resolve the active dataset's full data first.
        const ds = await useApp.getState().resolveDataset(activeId);
        if (cancelled || !ds) return;
        // Analysis view (excluded/filtered rows dropped, #50/#53) so a masked
        // outlier point doesn't skew Hc/Mr/Ms.
        const src = analysisData(ds) ?? ds.data;
        const h = src.time;
        const m = src.values.map((row) => row[0]);
        const r = await hysteresisAnalysis({ h, m });
        if (!cancelled) setResult(r);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "analysis failed");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Remove the linear dia/paramagnetic background fit to the high-field tails
  // and vertically centre the loop (per-tail slope + saturation-midpoint offset,
  // so no vertical shift remains). Writes an "(bg-sub)" dataset, never mutates.
  async function subtractBackground(): Promise<void> {
    if (!active) return;
    setBgBusy(true);
    setError(null);
    try {
      // #38 deferred edge: resolve the active dataset's full data first.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const src = analysisData(ds) ?? ds.data;
      const h = src.time;
      const m = src.values.map((row) => row[0]);
      const res = await subtractHysteresisBackground({ h, m });
      const data: DataStruct = {
        ...ds.data,
        time: h,
        values: res.corrected.map((v) => [v ?? Number.NaN]),
        labels: [ds.data.labels[0] ?? "Moment"],
        units: [ds.data.units[0] ?? ""],
        metadata: { ...ds.data.metadata, hysteresis_bg_subtracted: true },
      };
      const stem = ds.name.replace(/\.[^.]+$/, "");
      addDataset({ id: `hystbg-${++_bgCounter}`, name: `${stem} (bg-sub)`, data });
      setStatus(
        res.slope === 0 && res.offset === 0
          ? "no high-field background found (too few tail points)"
          : `removed background (slope ${res.slope.toExponential(2)}` +
              `, offset ${res.offset.toExponential(2)}) + centred loop`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "background subtraction failed");
    } finally {
      setBgBusy(false);
    }
  }

  return { active, result, busy, error, bgBusy, subtractBackground };
}
