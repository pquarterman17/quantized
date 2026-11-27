// The Peaks panel's settings state, in one place so the preset bar can read and
// write it: the COMMITTED find request (what the detector ran with; it changes
// only on "Find again"), the Advanced DRAFT (what the form shows), and the fit
// controls. A preset Apply writes the draft and the fit controls, never the
// committed request, so it cannot run a find (contract P8).

import { useState } from "react";

import { DEFAULT_PEAK_FIND, type PeakFindParams } from "./peakFindParams";
import { DEFAULT_PEAK_FIT_OPTIONS } from "./peakPresetSettings";
import type { PeakFindRequest, PeakFitOptions } from "./peakTypes";

export function usePeakSettings() {
  const [find, setFind] = useState<PeakFindRequest>({ params: { ...DEFAULT_PEAK_FIND }, seq: 0 });
  const [draft, setDraft] = useState<PeakFindParams>({ ...DEFAULT_PEAK_FIND });
  const [fitOpts, setFitOpts] = useState<PeakFitOptions>({ ...DEFAULT_PEAK_FIT_OPTIONS });
  /** "Find again" / "Defaults": the draft becomes the committed request and a find runs. */
  const commitFind = (params: PeakFindParams) => {
    setFind((f) => ({ params, seq: f.seq + 1 }));
    setDraft(params);
  };
  return { find, commitFind, draft, setDraft, fitOpts, setFitOpts };
}
