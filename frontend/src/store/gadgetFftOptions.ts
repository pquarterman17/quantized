// The plot FFT gadget's output choice (magnitude / PSD density / PSD power).
// Its own tiny store, session-only: lazy, so it costs the entry chunk nothing
// (read by store/gadgetRun.ts, set by components/Stage/GadgetFftOptions.tsx).

import { create } from "zustand";

import type { GadgetFftOutput } from "../lib/gadgetFftColumn";

export const useGadgetFftOptions = create<{ output: GadgetFftOutput; setOutput: (o: GadgetFftOutput) => void }>((set) => ({
  output: "magnitude",
  setOutput: (output) => set({ output }),
}));
