// Profiler workshop open state (GAP_AUDIT_9 G7). A standalone store (the
// store/fitModel.ts precedent: useApp sits at its size-ratchet pin). `model`
// is the fitted model handed over by Fit Model's "Profiler" button; with none,
// the workshop offers the saved Fit Model results.

import { create } from "zustand";
import type { ProfilerModel } from "../lib/api/modelEvaluate";

export interface ProfilerRequest {
  model: ProfilerModel;
  label: string;
}

interface ProfilerStoreState {
  open: boolean;
  request: ProfilerRequest | null;
  setOpen: (open: boolean) => void;
  openWith: (request: ProfilerRequest) => void;
}

export const useProfilerStore = create<ProfilerStoreState>((set) => ({
  open: false,
  request: null,
  setOpen: (open) => set({ open }),
  openWith: (request) => set({ open: true, request }),
}));
