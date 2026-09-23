import { useCallback } from "react";

import type { PeakTable } from "../../../lib/peakTable";
import { peakTableToFitResult } from "../../../lib/peakTableFit";
import type { Dataset, FittedPeak, MultiFitResult } from "../../../lib/types";
import { editPeak, removePeaks } from "../../../store/peakTables";
import { useApp } from "../../../store/useApp";
import { peakInputs } from "./peakInputs";

interface Args {
  activeId: string | null;
  setFitResult: (value: MultiFitResult | null) => void;
  setPeakOverlay: (value: ReturnType<typeof useApp.getState>["peakOverlay"]) => void;
  overlayFitted: (ds: Dataset, fitted: FittedPeak[], fullX: number[]) => void;
}

export function usePeakManualEdits({
  activeId,
  setFitResult,
  setPeakOverlay,
  overlayFitted,
}: Args) {
  const refresh = useCallback(async (table: PeakTable | null) => {
    if (!activeId) return;
    if (!table) {
      setFitResult(null);
      setPeakOverlay(null);
      return;
    }
    const next = peakTableToFitResult(table);
    setFitResult(next);
    const ds = await useApp.getState().resolveDataset(activeId);
    if (!ds || ds.id !== activeId) return;
    const st = useApp.getState();
    const { fullX } = peakInputs(ds, st.xKey, st.yKeys, st.seriesOrder);
    overlayFitted(ds, next.peaks, fullX);
  }, [activeId, overlayFitted, setFitResult, setPeakOverlay]);

  const editFittedPeak = useCallback(async (
    peakId: string,
    patch: { center: number; fwhm: number; height: number; area: number },
  ) => {
    if (!activeId) return;
    await refresh(editPeak(activeId, peakId, patch));
  }, [activeId, refresh]);

  const removeFittedPeaks = useCallback(async (peakIds: ReadonlySet<string>) => {
    if (!activeId || peakIds.size === 0) return;
    await refresh(removePeaks(activeId, peakIds));
  }, [activeId, refresh]);

  return { editFittedPeak, removeFittedPeaks };
}
