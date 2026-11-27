import { fmtWhen } from "../../../lib/locale";
const WAYS_BACK = "undo its delete to restore it, or re-import the data and run the tool again";
export const SOURCE_MISSING = `Source data not found — results can't be recalculated. To continue, ${WAYS_BACK}; the saved values stay available.`;
export const PEAK_SOURCE_MISSING = `Source data not found — the fitted peak table is unavailable until that worksheet is restored. To continue, ${WAYS_BACK}.`;
export const FIT_SOURCE_MISSING = `Source data not found — the saved fit is unavailable until that worksheet is restored. To continue, ${WAYS_BACK}.`;
/** Why "Open data" is off when the source worksheet is gone. */
export const OPEN_DATA_MISSING = `The source worksheet is missing, so there is no data to open: ${WAYS_BACK}.`;

/** A reflectivity curves / bands result whose fit record was trimmed out of the bounded fit history. */
export const REFL_RECORD_TRIMMED = "The fit record is no longer in the fit history (for example, a later fit replaced it); these worksheets stand as written.";

export const NOT_RECOMPUTABLE = "This output was computed once by its analysis tool and has no replayable recipe. Run the tool again to replace it; “Open in …” starts the tool from this result’s source and settings.";
export const COMMITTED_OUTPUT_STALE = "The source changed after this output was computed. Run the analysis again to replace it.";

export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-4)) return value.toExponential(6);
  return value.toLocaleString(undefined, { maximumSignificantDigits: 8 });
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : fmtWhen(date);
}
