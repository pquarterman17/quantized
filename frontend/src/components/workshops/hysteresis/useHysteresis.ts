// Hysteresis workshop — state hook. Runs the M-H loop analysis on the active
// dataset (H = the PLOTTED X, M = the primary plotted Y — audit P1 #1) via
// /api/magnetometry and surfaces the result/busy/error. Also offers a one-click
// linear-background subtract (the paramagnetic/diamagnetic high-field slope)
// that writes a corrected M-H dataset to the library. Re-runs analysis whenever
// the active dataset OR the plotted channels change.

import { useEffect, useState } from "react";

import { dropGapRows, restoreGapRows } from "../../../lib/api/finitePairs";
import { hysteresisAnalysis, subtractHysteresisBackground } from "../../../lib/api/magnetometry";
import { selectedFitData } from "../../../lib/fitselection";
import { analysisData } from "../../../lib/rowstate";
import type { CalcResult, Dataset, DataStruct } from "../../../lib/types";
import { nextDatasetId } from "../../../store/idSeq";
import { useActiveDataset, useApp } from "../../../store/useApp";

/** H = plotted X, M = primary plotted Y over the analysis view (excluded/
 *  filtered rows dropped, #50/#53) so a masked outlier doesn't skew Hc/Mr/Ms.
 *  `yKey` labels the corrected dataset the background-subtract writes. Falls
 *  back to the first channel vs time when nothing is plotted. */
function hm(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): { h: number[]; m: number[]; yKey: number } {
  const sel = selectedFitData(ds, xKey, yKeys, seriesOrder);
  if (sel) return { h: sel.x, m: sel.y, yKey: sel.yKey };
  const src = analysisData(ds) ?? ds.data;
  return { h: src.time, m: src.values.map((row) => row[0]), yKey: 0 };
}

export interface HysteresisState {
  active: Dataset | null;
  result: CalcResult | null;
  busy: boolean;
  /** Set when gap rows were excluded from the analysis — silently dropping
   *  measured rows is exactly the kind of quiet change the user must be told
   *  about, the same notice the magnetometry Background tab gives. */
  warning: string | null;
  error: string | null;
  bgBusy: boolean;
  subtractBackground: () => Promise<void>;
}

export function useHysteresis(): HysteresisState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [bgBusy, setBgBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    setWarning(null);
    if (!active) return;
    setBusy(true);
    const activeId = active.id;
    void (async () => {
      try {
        // #38 deferred edge: auto-analysis must never run on the small
        // preview — resolve the active dataset's full data first.
        const ds = await useApp.getState().resolveDataset(activeId);
        if (cancelled || !ds) return;
        const { h, m } = hm(ds, xKey, yKeys, seriesOrder);
        // A measured loop's gaps are NaN, `JSON.stringify` writes them as
        // `null`, and `list[float]` rejects each one — so this effect, which
        // fires automatically on dataset activation, 422'd on any gapped loop
        // before it could show anything (BUG-021 finding 2). `selectedFitData`
        // is a shared primitive used by every fit path and is deliberately
        // left alone; the filtering belongs at the request boundary.
        const pairs = dropGapRows(h, m);
        const r = await hysteresisAnalysis({ h: pairs.x, m: pairs.y });
        if (cancelled) return;
        if (!pairs.complete) {
          setWarning(
            `${pairs.n - pairs.keep.length} of ${pairs.n} rows are gaps; they were excluded from this analysis.`,
          );
        }
        setResult(r);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "analysis failed");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, xKey, yKeys, seriesOrder]);

  // Remove the linear dia/paramagnetic background fit to the high-field tails
  // and vertically centre the loop (per-tail slope + saturation-midpoint offset,
  // so no vertical shift remains). Writes an "(bg-sub)" dataset, never mutates.
  async function subtractBackground(): Promise<void> {
    if (!active) return;
    setBgBusy(true);
    setError(null);
    setWarning(null);
    try {
      // #38 deferred edge: resolve the active dataset's full data first.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const st = useApp.getState();
      const { h, m, yKey } = hm(ds, st.xKey, st.yKeys, st.seriesOrder);
      // Gaps out of the request, gaps back in on the SAME rows — so `time: h`
      // (the full original x) still lines up with `corrected`.
      const pairs = dropGapRows(h, m);
      if (pairs.keep.length < 2) {
        setError(
          `Only ${pairs.keep.length} of ${pairs.n} rows have both a finite field and a finite moment — not enough to fit a background.`,
        );
        return;
      }
      if (!pairs.complete) {
        setWarning(
          `${pairs.n - pairs.keep.length} of ${pairs.n} rows are gaps; they were excluded from the fit and stay gaps in the result.`,
        );
      }
      const res = await subtractHysteresisBackground({ h: pairs.x, m: pairs.y });
      const data: DataStruct = {
        ...ds.data,
        time: h,
        values: restoreGapRows(res.corrected, pairs).map((v) => [v]),
        labels: [ds.data.labels[yKey] ?? "Moment"],
        units: [ds.data.units[yKey] ?? ""],
        metadata: { ...ds.data.metadata, hysteresis_bg_subtracted: true },
      };
      const stem = ds.name.replace(/\.[^.]+$/, "");
      addDataset({ id: nextDatasetId(), name: `${stem} (bg-sub)`, data });
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

  return { active, result, busy, warning, error, bgBusy, subtractBackground };
}
