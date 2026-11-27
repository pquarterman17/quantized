// The curve-measurement gadget kinds' settings (level, dead band, rise-time
// percentages and reference levels, the second curve's worksheet). Their own
// tiny session-only store, like gadgetFftOptions: lazy, so it costs the entry
// chunk nothing (read by store/gadgetMeasureRun.ts, set by the chip's options).

import { create } from "zustand";

import { DEFAULT_GADGET_MEASURE_OPTIONS, type GadgetMeasureOptions } from "../lib/gadgetMeasureOptions";

export const useGadgetMeasureOptions = create<{
  options: GadgetMeasureOptions;
  set: (patch: Partial<GadgetMeasureOptions>) => void;
}>((set) => ({
  options: DEFAULT_GADGET_MEASURE_OPTIONS,
  set: (patch) => set((s) => ({ options: { ...s.options, ...patch } })),
}));
