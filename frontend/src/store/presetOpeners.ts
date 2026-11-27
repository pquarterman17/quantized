// Opens the tool a preset belongs to, for the Recipe Library's "Open in tool"
// (item 40 slice P6). A string result is the reason the tool could not open
// (Resample with no dataset). Opening never runs a tool. Lives in store/ with
// the other open-state handshakes; the dynamic imports keep the heavier tool
// stores out of the Library chunk until a preset for them is opened.

import { useAnalysisExtras } from "./analysisExtras";
import { openResampleDialog, useResampleDialog } from "./resampleDialog";
import { useApp } from "./useApp";

/** A synchronous open that cannot fail. */
const done = (open: () => void) => (): null => {
  open();
  return null;
};

/** Opens the tool; a string is the reason it could not. */
export const PRESET_OPENERS: Readonly<Record<string, () => string | null | Promise<string | null>>> = {
  baseline: done(() => useApp.getState().setBaselineOpen(true)),
  curvefit: done(() => useApp.getState().setCurveFitOpen(true)),
  distribution: done(() => useApp.getState().setDistributionOpen(true)),
  hysteresis: done(() => useApp.getState().setHysteresisOpen(true)),
  peaks: done(() => useApp.getState().setPeaksOpen(true)),
  "signal-processing": done(() => useApp.getState().setSignalProcessingOpen(true)),
  tabulate: done(() => useApp.getState().setTabulateOpen(true)),
  "time-series": done(() => useAnalysisExtras.getState().show("time-series")),
  resample: () => {
    // Already open: re-opening would re-seed (and reset) the form the preset is about to load into.
    if (useResampleDialog.getState().seed !== null) return null;
    const id = useApp.getState().activeId;
    if (!id) return "select a dataset first: Resample works on one";
    openResampleDialog([id]);
    return null;
  },
  multivar: async () => {
    (await import("./multivar")).useMultivarStore.getState().setOpen(true);
    return null;
  },
  variability: async () => {
    (await import("./variability")).useVariabilityStore.getState().setOpen(true);
    return null;
  },
  "outlier-screening": async () => {
    (await import("./outlierScreening")).useOutlierScreeningStore.getState().setOpen(true);
    return null;
  },
  "stats-tests": async () => {
    (await import("./statsTests")).useStatsTestsStore.getState().setOpen(true);
    return null;
  },
};


