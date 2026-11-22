// ROI cuts workshop, Box card "Stats" readout (split out of useRoiCuts.ts to
// keep it under the module ceiling). The readout is a numeric RESULT held in
// state, so it follows the workbench rule (lane WB7): it is stamped with the
// dataset's rows / data and the box it was measured for, marked "Out of date"
// (values withheld) once either moves, dropped when the active dataset
// changes, and an answer for a dataset left or a readout dropped in flight
// lands nowhere. The cuts themselves (Run / profiles) land library datasets
// named for the request that made them, so they carry no held result.

import { useEffect, useRef, useState } from "react";

import { rsmBoxStats, type BoxStats, type BoxStatsRequest } from "../../../lib/api/rsm";
import { normalizeRect, roiStatsBody, type RoiRect } from "../../../lib/roi";
import type { Dataset } from "../../../lib/types";
import { datasetInputsToken } from "../workbench/inputsKey";
import { useRunStamp } from "../workbench/useRunStamp";

export interface BoxStatsState {
  boxStats: BoxStats | null;
  /** The readout was measured for a box / rows that have since changed. */
  statsStale: boolean;
  statsBusy: boolean;
  statsError: string | null;
  runStats: () => Promise<void>;
  /** Drop the readout (a new dataset's first visit). */
  resetStats: () => void;
}

export function useBoxStats(active: Dataset | null, mapRoi: RoiRect | null): BoxStatsState {
  const [boxStats, setBoxStats] = useState<BoxStats | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const seq = useRef(0);
  const stamp = useRunStamp(JSON.stringify([datasetInputsToken(active), mapRoi]));
  const statsStale = boxStats !== null && stamp.stale;

  function resetStats(): void {
    seq.current++;
    stamp.record(null);
    setBoxStats(null);
    setStatsBusy(false);
    setStatsError(null);
  }

  // The numbers describe ONE dataset: leaving it drops them (also on a return
  // to a dataset whose sector settings are already banked).
  useEffect(() => {
    resetStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stamp` is a fresh object each render
  }, [active?.id]);

  async function runStats(): Promise<void> {
    if (!active || !mapRoi) return;
    const request = ++seq.current;
    const launchKey = stamp.launchKey();
    setStatsBusy(true);
    setStatsError(null);
    try {
      const body = roiStatsBody(active.data, normalizeRect(mapRoi)) as unknown as BoxStatsRequest;
      const res = await rsmBoxStats(body);
      if (request !== seq.current) return;
      stamp.record(launchKey);
      setBoxStats(res);
    } catch (e) {
      if (request !== seq.current) return;
      setStatsError(e instanceof Error ? e.message : "box stats failed");
    } finally {
      if (request === seq.current) setStatsBusy(false);
    }
  }

  return { boxStats, statsStale, statsBusy, statsError, runStats, resetStats };
}
