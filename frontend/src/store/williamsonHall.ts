import { create } from "zustand";

import type { WilliamsonHallRecipe } from "../lib/williamsonHallRecipe";

interface WilliamsonHallRequestState {
  request: WilliamsonHallRecipe | null;
  openWith: (request: WilliamsonHallRecipe) => void;
  consumeRequest: () => void;
}

export const useWilliamsonHallRequestStore = create<WilliamsonHallRequestState>((set) => ({
  request: null,
  openWith: (request) => set({ request }),
  consumeRequest: () => set({ request: null }),
}));
