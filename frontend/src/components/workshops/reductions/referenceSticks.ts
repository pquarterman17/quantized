// Commit one XRD reference pattern to the plot as a group of stick RefLines —
// the single writer shared by the file importer (ReferencePatternSection) and
// the built-in phase indexer (BuiltInPhaseIndexer). Each stick is an x RefLine
// with its reflection label (usually the (hkl)); the group's first line carries
// the pattern's provenance as `groupLabel` ("<name> · λ …"), which is where
// lib/peakPhaseMatch.ts reads the `{phase}` peak-label token from.

import type { ReferenceReflection } from "../../../lib/xrdReferencePattern";
import { nextPlotObjectId } from "../../../store/idSeq";
import { useApp } from "../../../store/useApp";

export interface StickStyle {
  baseline: number;
  height: number;
  color: string;
  showLabels: boolean;
}

/** Append `reflections` as one undoable reference-pattern group. */
export function addReferenceSticks(
  groupLabel: string,
  reflections: readonly ReferenceReflection[],
  style: StickStyle,
  recordHistory: (label: string) => void,
  historyLabel = "add XRD reference pattern",
): void {
  const groupId = nextPlotObjectId("reference-pattern");
  recordHistory(historyLabel);
  useApp.setState((state) => ({
    refLines: [...state.refLines, ...reflections.map((row, index) => ({
      id: nextPlotObjectId("ref"),
      axis: "x" as const,
      value: row.twoTheta,
      label: row.label,
      groupId,
      // Once per pattern, not on each of up to 2,000 sticks.
      ...(index === 0 ? { groupLabel } : {}),
      stick: {
        intensity: row.intensity,
        baseline: style.baseline,
        height: style.height,
        color: style.color,
        visible: true,
        showLabel: style.showLabels,
      },
    }))],
  }));
}
