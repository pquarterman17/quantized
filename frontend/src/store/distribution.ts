import { create } from "zustand";

import type { DistributionRecipe } from "../lib/distributionAnalysisResult";

interface DistributionRequestState {
  request: DistributionRecipe | null;
  openWith: (request: DistributionRecipe) => void;
  consumeRequest: () => void;
}

export const useDistributionRequestStore = create<DistributionRequestState>((set) => ({
  request: null,
  openWith: (request) => set({ request }),
  consumeRequest: () => set({ request: null }),
}));
