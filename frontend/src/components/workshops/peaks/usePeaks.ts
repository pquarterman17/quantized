// Peaks workshop — state hook. Finds peaks in the active dataset's first
// channel via /api/peaks and pushes markers into the store as a plot overlay
// (points only). Re-runs when the active (or corrected) dataset changes.

import { useEffect, useState } from "react";

import { findPeaks } from "../../../lib/api";
import { peakOverlayArray } from "../../../lib/plotdata";
import type { Dataset, Peak } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export interface PeaksState {
  active: Dataset | null;
  peaks: Peak[];
  busy: boolean;
  error: string | null;
}

export function usePeaks(): PeaksState {
  const active = useActiveDataset();
  const setPeakOverlay = useApp((s) => s.setPeakOverlay);
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPeaks([]);
    setError(null);
    if (!active) {
      setPeakOverlay(null);
      return;
    }
    setBusy(true);
    const time = active.data.time;
    const y = active.data.values.map((row) => row[0]);
    findPeaks({ x: time, y })
      .then((res) => {
        if (cancelled) return;
        setPeaks(res.peaks);
        const overlayY = peakOverlayArray(
          time,
          res.peaks.map((p) => ({ center: p.center, height: p.height })),
        );
        setPeakOverlay({ datasetId: active.id, y: overlayY });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "peak find failed");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, setPeakOverlay]);

  return { active, peaks, busy, error };
}
