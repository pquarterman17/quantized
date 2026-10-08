// Session-local correction state for the Peaks workshop's detector output.
// Fitted peaks already have their own durable edit path; this hook owns the
// pre-fit candidate list and keeps its plot markers synchronized after a
// manual add/remove.

import { useCallback, useRef, useState } from "react";

import { peakOverlayArray } from "../../../lib/plotdataExtras";
import type { Peak } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { manualPeakAt, type PeakDetectionData, withoutDetectedPeaks } from "./detectedPeakCuration";

export function useDetectedPeakCuration(activeId: string | null) {
  const setPeakOverlay = useApp((s) => s.setPeakOverlay);
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const listRef = useRef<Peak[]>([]);
  const dataRef = useRef<PeakDetectionData | null>(null);

  const publish = useCallback((next: Peak[]) => {
    listRef.current = next;
    setPeaks(next);
    const data = dataRef.current;
    if (!activeId || !data) return;
    setPeakOverlay({
      datasetId: activeId,
      y: peakOverlayArray(
        data.fullX,
        next.map((p) => ({ center: p.center, height: p.height + p.bg })),
      ),
    });
  }, [activeId, setPeakOverlay]);

  const clearDetectedPeaks = useCallback(() => {
    dataRef.current = null;
    listRef.current = [];
    setPeaks([]);
    setPeakOverlay(null);
  }, [setPeakOverlay]);

  const setFoundPeaks = useCallback((found: Peak[], data: PeakDetectionData) => {
    dataRef.current = data;
    publish(found);
  }, [publish]);

  const addDetectedPeakAt = useCallback((at: number) => {
    const data = dataRef.current;
    if (!data) return;
    const added = manualPeakAt(data, at);
    if (!added) {
      toast("Could not add a peak at that position.", "danger");
      return;
    }
    const duplicate = listRef.current.some((p) => p.center === added.center);
    if (duplicate) {
      toast("A peak already exists at that position.");
      return;
    }
    publish([...listRef.current, added].sort((a, b) => a.center - b.center));
  }, [publish]);

  const removeDetectedPeaks = useCallback((indices: ReadonlySet<number>) => {
    if (indices.size > 0) publish(withoutDetectedPeaks(listRef.current, indices));
  }, [publish]);

  return { peaks, clearDetectedPeaks, setFoundPeaks, addDetectedPeakAt, removeDetectedPeaks };
}
