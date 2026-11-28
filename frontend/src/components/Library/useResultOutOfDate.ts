// Acceptance pass 15 U6: a snapshot result (Fit Y by X, Statistical tests, ...) is judged out of date by its source
// FINGERPRINT, which `entity.stale` does not carry until something stamps it, so its Library row never said so while
// the result window did. This asks the window's own authority (`snapshotResultState`), through a lazy import so the
// eager Library bundle does not grow by the freshness module.

import { useEffect, useState } from "react";

import type { AnalysisResult } from "../../lib/analysisResult";
import { useApp } from "../../store/useApp";

/** True when `result` is out of date: flagged stale, or (a snapshot result) its sources no longer match. */
export function useResultOutOfDate(result: AnalysisResult | null): boolean {
  const datasets = useApp((s) => (result ? s.datasets : null)); // stable references; null keeps other rows idle
  const results = useApp((s) => (result ? s.analysisResults : null));
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!result || !datasets) return;
    let live = true;
    void import("../../lib/analysisResultFreshness")
      .then((m) => live && setLate(m.isSnapshotResult(result) && m.snapshotResultState(result, datasets, results ?? undefined) === "out-of-date"))
      .catch(() => undefined); // the chunk would not load: the flag alone decides
    return () => { live = false; };
  }, [result, datasets, results]);
  return !!result?.stale || late;
}
