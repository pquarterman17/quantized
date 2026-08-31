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
import { expandToFullRows, type PeakRecipe } from "../../../lib/peakwizard";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

/** The `cutRange` result the wizard works on: the in-range x/y plus the row
 *  indices they came from, so an overlay can be expanded back to full rows. */
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
  const [baseline, setBaseline] = useState<(number | null)[] | null>(null);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [baselineError, setBaselineError] = useState<string | null>(null);

  // ① Baseline on the working segment; overlays onto the FULL plot x.
  useEffect(() => {
    setBaseline(null);
    setBaselineError(null);
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
        setBaseline(res.baseline);
        setBaselineOverlay({
          datasetId: ds.id,
          y: expandToFullRows(res.baseline, segment.kept, ds.data.time.length),
        });
      } catch (e: unknown) {
        if (!cancelled) setBaselineError(e instanceof Error ? e.message : "baseline failed");
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
