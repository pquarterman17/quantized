// Axis-title drag bridge for buildOpts (mirrors useAnnotationEdit). The saved
// offsets ALWAYS apply — a repositioned title stays put in every tool — while
// the drag/reset interaction is enabled only in the pointer tool. Kept tiny so
// PlotStage stays under its component ceiling.

import { useMemo } from "react";

import type { AxisLabelEditOpts } from "../../lib/uplotRichLabels";
import { useApp } from "../../store/useApp";

export function useAxisLabelEdit(tool: string): AxisLabelEditOpts {
  const offsets = useApp((s) => s.axisLabelOffsets);
  const setAxisLabelOffset = useApp((s) => s.setAxisLabelOffset);
  return useMemo(
    () => ({
      offsets,
      interactive: tool === "pointer",
      onMove: (axis, offset) => setAxisLabelOffset(axis, offset),
      onReset: (axis) => setAxisLabelOffset(axis, null),
    }),
    [tool, offsets, setAxisLabelOffset],
  );
}
