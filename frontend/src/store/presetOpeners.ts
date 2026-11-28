// Opens the tool a preset belongs to, for the Recipe Library's "Open in tool"
// (item 40 slice P6). A string result is the reason the tool could not open
// (Resample with no dataset). Opening never runs a tool. Lives in store/ with
// the other open-state handshakes; the dynamic imports keep the heavier tool
// stores out of the Library chunk until a preset for them is opened.

import { useAnalysisExtras } from "./analysisExtras";
import { openResampleDialog, useResampleDialog } from "./resampleDialog";
import type { SimsTab } from "./simsDialog";
import { useApp } from "./useApp";

/** A synchronous open that cannot fail. */
const done = (open: () => void) => (): null => {
  open();
  return null;
};

/** Opens the SIMS workshop on one of its tabs (it works on a dataset, so one must be active). */
const simsTab = (tab: SimsTab) => async (): Promise<string | null> => {
  const id = useApp.getState().activeId;
  if (!id) return "select a dataset first: SIMS depth profile works on one";
  (await import("./simsDialog")).openSimsDialog(id, tab);
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
  "map-ops": done(() => useAnalysisExtras.getState().show("map-ops")),
  "fft-thickness": done(() => useApp.getState().openReductions("fft-thickness")),
  "williamson-hall": done(() => useApp.getState().openReductions("williamson-hall")),
  pawley: done(() => useApp.getState().openReductions("pawley")),
  "xrd-reference": done(() => useApp.getState().openReductions("xrd-reference")),
  "reflectivity-fft": done(() => useApp.getState().openReductions("reflectivity-fft")),
  "optical-gap": done(() => useAnalysisExtras.getState().show("optical-gap")),
  "surface-fit": done(() => useAnalysisExtras.getState().show("surface-fit")),
  doe: async () => {
    (await import("./doe")).useDoeStore.getState().setOpen(true);
    return null;
  },
  sims: async () => {
    const id = useApp.getState().activeId;
    if (!id) return "select a dataset first: SIMS depth profile works on one";
    (await import("./simsDialog")).openSimsDialog(id);
    return null;
  },
  "sims-compare": simsTab("compare"),
  "sims-align": simsTab("align"),
  "sims-region": simsTab("region"),
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


