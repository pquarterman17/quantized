// Opt-in direct manipulation for the ordinary Peaks panel.  It reuses the
// plot bridge/plugin introduced by Peak Analyzer: click empty plot space to
// add a snapped candidate; click a marker to remove it.  The legacy store
// field is named `peakWizardEdit`, but is a generic thin bridge at runtime.

import { useEffect, useRef, useState } from "react";

import { useEscapeSurface } from "../../../lib/escapeStack";
import { isInsideToolWindow } from "../../../lib/toolwindow";
import type { Peak } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

interface Inputs {
  activeId: string | null;
  allowed: boolean;
  peaks: readonly Peak[];
  addPeakAt: (x: number) => void;
  removePeak: (index: number) => void;
}

export function useDetectedPeakPlotEdit({ activeId, allowed, peaks, addPeakAt, removePeak }: Inputs) {
  const [editing, setEditing] = useState(false);
  const setBridge = useApp((s) => s.setPeakWizardEdit);
  const currentBridge = useApp((s) => s.peakWizardEdit);
  const bridgeRef = useRef(currentBridge);
  bridgeRef.current = currentBridge;
  const peakWizardOpen = useApp((s) => s.peakWizardOpen);
  const active = editing && allowed && !!activeId && !peakWizardOpen;

  useEffect(() => {
    if (!allowed || !activeId || peakWizardOpen) setEditing(false);
  }, [allowed, activeId, peakWizardOpen]);

  useEffect(() => {
    if (active) {
      setBridge({
        markers: peaks.map((p, index) => ({ index, center: p.center, height: p.height + p.bg })),
        addPeakAt,
        removePeak,
      });
    } else if (bridgeRef.current?.addPeakAt === addPeakAt) {
      setBridge(null);
    }
    return () => {
      // Do not clear a Peak Analyzer bridge that replaced ours meanwhile.
      if (bridgeRef.current?.addPeakAt === addPeakAt) setBridge(null);
    };
  }, [active, peaks, addPeakAt, removePeak, setBridge]);

  const stop = () => {
    setEditing(false);
    return true;
  };
  useEscapeSurface("window", (e) => isInsideToolWindow(e.target, "peaks") && stop(), active);
  useEscapeSurface("selection", stop, active);

  return { editing: active, setEditing };
}
