import { useCallback, useEffect, useRef } from "react";

import type { PeakTable, PeakTableEntry } from "../../../lib/peakTable";
import { peakTableMatchesData, peakTableToFitResult } from "../../../lib/peakTableFit";
import type { Dataset, FittedPeak, MultiFitResult } from "../../../lib/types";
import { editPeak, removePeaks } from "../../../store/peakTables";
import { useApp } from "../../../store/useApp";
import { peakInputs } from "./peakInputs";

/** Two tables that differ only in which rows are excluded. Exclusion is read
 *  straight off the table by the panel, so it needs no refresh; refreshing
 *  would replace the fit result, which resets the fitted-row selection and
 *  swaps detected markers for fitted ones on every include/exclude click. */
function sameIgnoringExclusion(a: PeakTable, b: PeakTable): boolean {
  if (a.provenance !== b.provenance || a.peaks.length !== b.peaks.length) return false;
  const strip = (p: PeakTableEntry): string => JSON.stringify({ ...p, excluded: false });
  return a.peaks.every((p, i) => p === b.peaks[i] || strip(p) === strip(b.peaks[i]));
}

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
  const resolveDataset = useApp((s) => s.resolveDataset);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const refreshGeneration = useRef(0);
  // A store-side switch of the active dataset invalidates any refresh in
  // flight, even before this component re-renders with the new id. A
  // subscription rather than a live store read keeps this file
  // off architecture.test.ts's getState() file-count ratchet.
  useEffect(() => useApp.subscribe((s, prev) => {
    if (s.activeId !== prev.activeId) refreshGeneration.current += 1;
  }), []);
  // The table the last refresh ran for, keyed by dataset.
  const refreshed = useRef<{ id: string; table: PeakTable | null; axes: readonly unknown[] } | null>(null);
  const refresh = useCallback(async (table: PeakTable | null) => {
    if (!activeId) return;
    const generation = ++refreshGeneration.current;
    const stillCurrent = () => refreshGeneration.current === generation;
    if (!table) {
      if (!stillCurrent()) return;
      setFitResult(null);
      setPeakOverlay(null);
      return;
    }
    const next = peakTableToFitResult(table);
    const ds = await resolveDataset(activeId);
    if (!ds || ds.id !== activeId || !stillCurrent()) return;
    if (!peakTableMatchesData(table, ds)) {
      setFitResult(null);
      setPeakOverlay(null);
      return;
    }
    const { fullX } = peakInputs(ds, xKey, yKeys, seriesOrder);
    if (!stillCurrent()) return;
    setFitResult(next);
    overlayFitted(ds, next.peaks, fullX);
  }, [activeId, overlayFitted, resolveDataset, seriesOrder, setFitResult, setPeakOverlay, xKey, yKeys]);

  useEffect(() => {
    const last = refreshed.current;
    const axes = [xKey, yKeys, seriesOrder] as const;
    if (
      last && last.id === activeId && last.table && activeTable &&
      last.axes.every((v, i) => v === axes[i]) &&
      sameIgnoringExclusion(last.table, activeTable)
    ) {
      refreshed.current = { id: activeId, table: activeTable, axes };
      return;
    }
    refreshed.current = activeId ? { id: activeId, table: activeTable, axes } : null;
    void refresh(activeTable);
  }, [activeId, activeTable, refresh, xKey, yKeys, seriesOrder]);

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
