// Browse graph's session settings (gap plan item 22): how many curves one step
// shows, and the size of the group the last step left on the graph. Not saved
// in the workspace: a fresh session starts at 1 curve per step, today's behaviour.

import { create } from "zustand";

import { cleanPerStep } from "../lib/browseGroup";

interface BrowseSettings {
  /** Curves per step (N >= 1). */
  perStep: number;
  setPerStep: (n: number) => void;
  /** The group the last step wrote: the graph, its first layer slot and its size. */
  group: { graphId: string; index: number; size: number } | null;
}

export const useBrowseSettings = create<BrowseSettings>((set) => ({
  perStep: 1,
  setPerStep: (n) => set({ perStep: cleanPerStep(n) }),
  group: null,
}));

/** The remembered group size for the graph `graphId` at layer slot `index` (1 when it is another graph or place). */
export const rememberedSize = (graphId: string | null, index: number): number => {
  const g = useBrowseSettings.getState().group;
  return g && g.graphId === graphId && g.index === index ? g.size : 1;
};
