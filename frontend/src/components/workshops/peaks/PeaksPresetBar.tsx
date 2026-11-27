// Peaks' preset bar: the shared bar over the Peaks adapter, which reads and
// writes peak recipes. Mounted by PeaksPanel through a lazy seam, so none of it
// is eager. Also remembers last-used settings after a fit that succeeds
// (never on Apply, and not for a fit that failed, was declined or found nothing).

import { useEffect, useRef } from "react";

import PresetBar from "../presets/PresetBar";
import { createPeaksAdapter, recordPeaksRun } from "./presetAdapter";
import type { PeakFindParams } from "./peakFindParams";
import type { PeakFitOptions } from "./peakTypes";

export interface PeaksPresetSettings {
  /** The committed find request: what the detector ran with. */
  committed: PeakFindParams;
  draft: PeakFindParams;
  setDraft: (find: PeakFindParams) => void;
  fitOpts: PeakFitOptions;
  setFitOpts: (fit: PeakFitOptions) => void;
}

interface Props {
  settings: PeaksPresetSettings;
  fitting: boolean;
  fitError: string | null;
  fittedPeaks: number;
}

export default function PeaksPresetBar({ settings, fitting, fitError, fittedPeaks }: Props) {
  const live = useRef(settings);
  live.current = settings;
  // The settings a fit started with, kept until it ends: success = it ended with no error and a peak.
  const started = useRef<{ find: PeakFindParams; fit: PeakFitOptions } | null>(null);
  useEffect(() => {
    if (fitting) {
      started.current = { find: live.current.committed, fit: live.current.fitOpts };
    } else if (started.current) {
      if (!fitError && fittedPeaks > 0) recordPeaksRun(started.current.find, started.current.fit);
      started.current = null;
    }
  }, [fitting, fitError, fittedPeaks]);

  const adapter = createPeaksAdapter({
    getDraft: () => live.current.draft,
    getFitOptions: () => live.current.fitOpts,
    setDraft: (f) => live.current.setDraft(f),
    setFitOptions: (f) => live.current.setFitOpts(f),
  });
  return <PresetBar adapter={adapter} fromResult={false} running={fitting} />;
}
