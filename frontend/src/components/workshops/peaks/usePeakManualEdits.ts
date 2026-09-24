import { useCallback, useEffect, useRef } from "react";

import type { PeakTable } from "../../../lib/peakTable";
import { peakTableMatchesData, peakTableToFitResult } from "../../../lib/peakTableFit";
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
  const activeTable = useApp((s) => s.datasets.find((d) => d.id === activeId)?.peakTable ?? null);
  const refreshGeneration = useRef(0);
  const refresh = useCallback(async (table: PeakTable | null) => {
    if (!activeId) return;
    const generation = ++refreshGeneration.current;
    const stillCurrent = () =>
      refreshGeneration.current === generation && useApp.getState().activeId === activeId;
    if (!table) {
      if (!stillCurrent()) return;
      setFitResult(null);
      setPeakOverlay(null);
      return;
    }
    const next = peakTableToFitResult(table);
    const ds = await useApp.getState().resolveDataset(activeId);
    if (!ds || ds.id !== activeId || !stillCurrent()) return;
    if (!peakTableMatchesData(table, ds)) {
      setFitResult(null);
      setPeakOverlay(null);
      return;
    }
    const st = useApp.getState();
    const { fullX } = peakInputs(ds, st.xKey, st.yKeys, st.seriesOrder);
    if (!stillCurrent()) return;
    setFitResult(next);
    overlayFitted(ds, next.peaks, fullX);
  }, [activeId, overlayFitted, setFitResult, setPeakOverlay]);

  useEffect(() => {
    void refresh(activeTable);
  }, [activeTable, refresh]);

  const editFittedPeak = useCallback(async (
    peakId: string,
    patch: { center: number; fwhm: number; height: number; area: number },
  ) => {
    if (!activeId) return;
    editPeak(activeId, peakId, patch);
  }, [activeId]);

  const removeFittedPeaks = useCallback(async (peakIds: ReadonlySet<string>) => {
    if (!activeId || peakIds.size === 0) return;
    removePeaks(activeId, peakIds);
  }, [activeId]);

  return { editFittedPeak, removeFittedPeaks };
}
