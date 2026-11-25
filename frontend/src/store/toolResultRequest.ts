// Reopen requests for the Time series, DOE and Profiler result kinds (owner
// decision 2026-11-25): the Library's "Reopen in tool" hands a saved result's
// recipe to its workshop through here, and the workshop consumes it once it
// has mounted on the right worksheet. One tiny lazy store for the three, so
// the eager stores (store/doe.ts, store/profiler.ts, store/analysisExtras.ts)
// stay as they are.

import { create } from "zustand";

import type { DoeDesignRecipe, ProfilerRecipe, TimeSeriesRecipe } from "../lib/toolResultKinds";

interface ToolResultRequestState {
  timeSeries: TimeSeriesRecipe | null;
  doe: DoeDesignRecipe | null;
  profiler: ProfilerRecipe | null;
  request: (patch: Partial<Pick<ToolResultRequestState, "timeSeries" | "doe" | "profiler">>) => void;
  consume: (kind: "timeSeries" | "doe" | "profiler") => void;
}

export const useToolResultRequest = create<ToolResultRequestState>((set) => ({
  timeSeries: null,
  doe: null,
  profiler: null,
  request: (patch) => set(patch),
  consume: (kind) => set({ [kind]: null }),
}));
