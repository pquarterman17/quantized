// The points collected by the Pick tool (lib/pickPoints.ts), until they are
// made into a worksheet. Session-only on purpose: a half-collected pick list is
// scratch, so it is not saved in the workspace and is not part of undo; making
// the worksheet is the one undoable step (an ordinary `addDataset`).
// Loaded on demand (the Pick tool's click and the Graph browser window).

import { create } from "zustand";

import { pickedData, withPick, type PickedPoint } from "../lib/pickPoints";
import { nextDatasetId, useApp } from "./useApp";

interface State {
  points: readonly PickedPoint[];
  /** Add a point; false when that exact point is already collected. */
  add: (p: PickedPoint) => boolean;
  removeAt: (i: number) => void;
  clear: () => void;
}

export const usePickedPoints = create<State>((set, get) => ({
  points: [],
  add: (p) => {
    const next = withPick(get().points, p);
    if (next === get().points) return false;
    set({ points: next });
    return true;
  },
  removeAt: (i) => set((s) => ({ points: s.points.filter((_, j) => j !== i) })),
  clear: () => set({ points: [] }),
}));

/** Make the collected points a new worksheet (one undo step) and empty the list.
 *  Returns the new dataset's id, or null when nothing was collected. */
export function makePickedWorksheet(name: string): string | null {
  const { points, clear } = usePickedPoints.getState();
  if (points.length === 0) return null;
  const id = nextDatasetId();
  useApp.getState().addDataset({ id, name: name.trim() || "picked points", data: pickedData(points) });
  useApp.getState().setStatus(`picked ${points.length} point${points.length === 1 ? "" : "s"} → ${name.trim() || "picked points"}`);
  clear();
  return id;
}
