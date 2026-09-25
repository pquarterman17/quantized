// Step ① of the Peak Wizard: run the configured auto-baseline over the working
// segment and publish the overlay onto the FULL plot x.
//
// Extracted from `usePeakWizard.ts` verbatim (P3.5) — that file sat at 499
// against the general 500-line .ts ceiling, so the recently-used wiring it
// needed had to be funded by a split rather than a bigger number. This is the
// cohesive unit to take: one effect, one concern (baseline for the current
// segment), and every piece of state it writes is written by nothing else.
// The busy/error/result triple is returned rather than passed in, so the
// ownership is visible at the call site instead of being three more setters
// threaded down.

import { useEffect, useState } from "react";

import { baselineALS, baselineModPoly, baselineRollingBall } from "../../../lib/api/baseline";
import type { PeakRecipe } from "../../../lib/peakwizard";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { segmentToFullRows } from "./modelFitOverlay";

/** The `cutRange` result the wizard works on: the in-range x/y plus the
 *  ANALYSIS-view row indices they came from (modelFitOverlay's `segmentRows`
 *  maps those to full rows). */
export interface WorkingSegment {
  x: number[];
  y: number[];
  kept: number[];
}

export interface PeakBaselineState {
  baseline: (number | null)[] | null;
  baselineBusy: boolean;
  baselineError: string | null;
}

export function usePeakBaseline(
  active: Dataset | null | undefined,
  segment: WorkingSegment | null,
  recipeBaseline: PeakRecipe["baseline"],
  setBaselineOverlay: (v: { datasetId: string; y: (number | null)[] } | null) => void,
): PeakBaselineState {
  // The estimate is kept WITH the segment it was computed for, and handed out
  // only while that is still the segment (slice 3): between a range change
  // and this effect's reset, the old range's baseline must not be subtracted
  // from the new range's y — "Fit this range" finds peaks the moment a
  // baseline is present, so the old one would be used.
  const [result, setResult] = useState<{ segment: WorkingSegment; baseline: (number | null)[] } | null>(null);
  const baseline = result && result.segment === segment ? result.baseline : null;
  const [baselineBusy, setBaselineBusy] = useState(false);
  // Same for a failure: an old range's error must not cancel the new range's find.
  const [failure, setFailure] = useState<{ segment: WorkingSegment; message: string } | null>(null);
  const baselineError = failure && failure.segment === segment ? failure.message : null;

  // ① Baseline on the working segment; overlays onto the FULL plot x.
  useEffect(() => {
    setResult(null);
    setFailure(null);
    // A cancelled run never clears busy itself (its `finally` is skipped), so
    // every run starts from not-busy — switching to "none" mid-estimate used
    // to leave "estimating baseline…" up for good.
    setBaselineBusy(false);
    if (!active || !segment || segment.x.length === 0) {
      setBaselineOverlay(null);
      return;
    }
    if (recipeBaseline.method === "none") {
      setBaselineOverlay(null);
      return;
    }
    let cancelled = false;
    setBaselineBusy(true);
    const activeId = active.id;
    const b = recipeBaseline;
    void (async () => {
      try {
        // #38 deferred edge: auto-baseline must never run on the small
        // preview — resolve the active dataset's full data first (a no-op
        // if it isn't pending). The working `segment` itself is unaffected
        // (recomputed reactively once `active` swaps), so this only guards
        // the eagerly-fired first step.
        const ds = await useApp.getState().resolveDataset(activeId);
        if (cancelled || !ds) return;
        const res = await (b.method === "als"
          ? baselineALS({ y: segment.y, lam: b.lam, p: b.p })
          : b.method === "rollingball"
            ? baselineRollingBall({ y: segment.y, radius: b.radius })
            : baselineModPoly({ y: segment.y, order: b.order }));
        if (cancelled) return;
        setResult({ segment, baseline: res.baseline });
        // Segment point i is ANALYSIS row kept[i]; with excluded or
        // filtered-out rows that is not full row kept[i] (slice-3 fix: the
        // preview used to drift one row per dropped row ahead of it).
        setBaselineOverlay({ datasetId: ds.id, y: segmentToFullRows(res.baseline, ds, segment.kept) });
      } catch (e: unknown) {
        if (!cancelled) setFailure({ segment, message: e instanceof Error ? e.message : "baseline failed" });
      } finally {
        if (!cancelled) setBaselineBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, segment, recipeBaseline, setBaselineOverlay]);

  return { baseline, baselineBusy, baselineError };
}
