export const SOURCE_MISSING = "Source data not found — results can't be recalculated.";
export const PEAK_SOURCE_MISSING = "Source data not found — the fitted peak table is unavailable until that worksheet is restored.";
export const FIT_SOURCE_MISSING = "Source data not found — the saved fit is unavailable until that worksheet is restored.";

export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-4)) return value.toExponential(6);
  return value.toLocaleString(undefined, { maximumSignificantDigits: 8 });
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
