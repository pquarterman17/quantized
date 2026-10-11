import type { PeakTable } from "../../../lib/peakTable";
import type { Dataset, MultiFitResult, Peak } from "../../../lib/types";
import type { PeakFindParams } from "./peakFindParams";

export interface PeakFitOptions {
  model: string;
  bgDegree: number;
  linkMode: string;
  constrain: boolean;
}

export interface PeakFindRequest {
  params: PeakFindParams;
  seq: number;
}

export interface PeaksState {
  active: Dataset | null;
  peaks: Peak[];
  busy: boolean;
  error: string | null;
  fitResult: MultiFitResult | null;
  peakTable: PeakTable | null;
  toggleExcluded: (peakId: string, excluded: boolean) => void;
  editFittedPeak: (peakId: string, patch: { center: number; fwhm: number; height: number; area: number }) => Promise<void>;
  removeFittedPeaks: (peakIds: ReadonlySet<string>) => Promise<void>;
  addDetectedPeakAt: (x: number) => void;
  removeDetectedPeaks: (indices: ReadonlySet<number>) => void;
  fitting: boolean;
  fitError: string | null;
  fitTogether: (opts: PeakFitOptions) => Promise<void>;
  fitEach: (opts: PeakFitOptions) => Promise<void>;
  labelPeaks: (selectedIndices?: ReadonlySet<number>) => Promise<void>;
}
