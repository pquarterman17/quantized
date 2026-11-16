// UX-A: the plot object the Pointer tool has selected — a curve, an axis or
// the legend — beside the annotation / shape selections that already live in
// useApp (`selectedAnnotationId`, `selectedShapeId`). A dependency-light
// zustand store (the store/figureDialogs.ts shape) rather than a useApp
// field: selection is VIEW state only, so it must never reach a `.dwk`, and a
// store of its own cannot be snapshotted, hydrated or serialized by accident.
// Only the lazy Inspector and the lazy on-canvas selection layer import it.
//
// One selection at a time, like Figma: picking a plot object clears the
// annotation / shape selection, and the Inspector clears this one when an
// annotation or shape becomes selected (`useExclusiveSelection`).

import { useEffect } from "react";
import { create } from "zustand";

import type { AxisId } from "./figureDialogs";
import { useApp } from "./useApp";

/** `channel` is the DATASET channel index (the `plotDetails` convention), not
 *  the display position, so the selection survives a series reorder. */
export type PlotSelection =
  | { kind: "series"; channel: number }
  | { kind: "axis"; axis: AxisId }
  | { kind: "legend" };

export const usePlotSelection = create<{ sel: PlotSelection | null }>(() => ({ sel: null }));

/** Select a plot object (null clears). A non-null pick also drops any
 *  annotation / shape selection, so exactly one object is ever selected. */
export function selectPlotObject(sel: PlotSelection | null): void {
  usePlotSelection.setState({ sel });
  if (!sel) return;
  const s = useApp.getState();
  if (s.selectedAnnotationId) s.setSelectedAnnotationId(null);
  if (s.selectedShapeId) s.setSelectedShapeId(null);
}

/** Clear every selection: plot object, annotation and shape. */
export function clearAllSelection(): void {
  usePlotSelection.setState({ sel: null });
  const s = useApp.getState();
  if (s.selectedAnnotationId) s.setSelectedAnnotationId(null);
  if (s.selectedShapeId) s.setSelectedShapeId(null);
}

/** A stable string for a selection (effect deps, `<select>` values). */
export function selectionKey(sel: PlotSelection | null): string {
  if (!sel) return "";
  if (sel.kind === "series") return `series:${sel.channel}`;
  if (sel.kind === "axis") return `axis:${sel.axis}`;
  return "legend";
}

/** The inverse of `selectionKey` ("" or an unknown key → null). */
export function parseSelectionKey(key: string): PlotSelection | null {
  if (key === "legend") return { kind: "legend" };
  const [kind, rest] = key.split(":");
  if (kind === "axis" && (rest === "x" || rest === "y" || rest === "y2")) return { kind: "axis", axis: rest };
  if (kind === "series" && rest !== undefined && /^\d+$/.test(rest)) return { kind: "series", channel: Number(rest) };
  return null;
}

/** Clear the plot selection once an annotation or shape becomes selected (the
 *  other half of the one-selection rule; the Inspector mounts this). */
export function useExclusiveSelection(): void {
  const objectSelected = useApp((s) => Boolean(s.selectedAnnotationId || s.selectedShapeId));
  useEffect(() => {
    if (objectSelected && usePlotSelection.getState().sel) usePlotSelection.setState({ sel: null });
  }, [objectSelected]);
}
