// Statistical tests workshop open state. A standalone store (the
// store/multivar.ts precedent) rather than a flag on useApp.ts, which sits at
// its size-ratchet pin.

import { create } from "zustand";

import type { StatsTestId } from "../lib/api/statsTests";
import type { TestParams, TestSelection } from "../lib/statsTests";

export interface StatsTestsRequest {
  testId: StatsTestId;
  selection: TestSelection;
  params: TestParams;
}

interface StatsTestsStoreState {
  open: boolean;
  request: StatsTestsRequest | null;
  setOpen: (open: boolean) => void;
  openWith: (request: StatsTestsRequest) => void;
  consumeRequest: () => void;
}

export const useStatsTestsStore = create<StatsTestsStoreState>((set) => ({
  open: false,
  request: null,
  setOpen: (open) => set({ open }),
  openWith: (request) => set({ open: true, request }),
  consumeRequest: () => set({ request: null }),
}));
