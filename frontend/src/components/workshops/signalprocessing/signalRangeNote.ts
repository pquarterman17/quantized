// The optional X range of a Signal Processing run, said next to the included-row
// count: how many of the rows the run reads fall inside it. The range is
// inclusive at both ends (calc/corrections.py, calc/spectral_grid.py). Empty
// when no range is set or the entered range is not a finite, increasing pair
// (the panel's own validation message says why instead).

import type { Dataset } from "../../../lib/types";
import { isSpectralOperation, signalInputData, type SignalSettings } from "./signalProcessingModel";
import type { SpectralUiSettings } from "./spectralSettings";

const finite = (text: string): number | null => (text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : null);

export function signalRangeNote(source: Dataset, settings: SignalSettings, spectral: SpectralUiSettings): string {
  const range = isSpectralOperation(settings.operation) ? spectral : settings;
  return rangeNoteFor(signalInputData(source, settings.useAllRows).time, range);
}

/** The same sentence for any body that reads `x` (the filters and the spectrogram read the analysis rows). */
export function rangeNoteFor(x: readonly number[], range: { useRange: boolean; xMin: string; xMax: string }): string {
  if (!range.useRange) return "";
  const lo = finite(range.xMin);
  const hi = finite(range.xMax);
  if (lo === null || hi === null || lo >= hi) return "";
  const inside = x.reduce((n, value) => n + (Number.isFinite(value) && value >= lo && value <= hi ? 1 : 0), 0);
  return `Limited to X ${lo.toLocaleString()} to ${hi.toLocaleString()} (inclusive): ${inside.toLocaleString()} of ${x.length.toLocaleString()} input rows fall inside it.`;
}
