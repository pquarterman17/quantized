// "Does this poor single-peak fit leave a SECOND peak behind?" (acceptance 5, u14).
// A Cu K-alpha doublet fitted with one peak reads "poor fit, try a range"; the
// useful hint is that what the fit missed is a second peak. A least-squares single
// peak locks onto the stronger line, so the residual is that second line: ONE
// isolated hump over an otherwise flat residual. (Two residual humps either side of
// the fitted peak look the same for a doublet fitted between its lines AND for a
// plain shape mismatch, so they are NOT used: the rule only fires on the isolated hump.)
//
// Deliberately simple and conservative (it only ever adds a suggestion to a fit
// already called poor, and only for a peak model): smooth the residuals, then
//  * the tallest positive hump must clear the smoothed noise floor (4 sigma / sqrt(window),
//    sigma from the MAD of the raw-minus-smoothed residual),
//  * no negative excursion may exceed 30 % of it (a shape mismatch swings both ways),
//  * the samples above half its height must form ONE run, narrower than a quarter of the
//    range (a baseline offset or a bad range is broad, not a peak).
// Pure: numbers in, boolean out.

/** The wording appended to the poor-fit status, with the real menu path. */
export const SECOND_PEAK_HINT = "or a 2-peak model (Analyze › Peaks & baseline › Find peaks…)";

const MIN_POINTS = 30;

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** True when `residuals` (zero-weight points ignored) hold one isolated positive hump. */
export function hasSecondResidualMaximum(residuals: readonly unknown[], weights?: readonly (number | null)[] | null): boolean {
  const use = weights && weights.length === residuals.length;
  const r: number[] = [];
  residuals.forEach((v, i) => {
    if (use && !((weights[i] ?? Number.NaN) > 0)) return;
    if (typeof v === "number" && Number.isFinite(v)) r.push(v);
  });
  const n = r.length;
  if (n < MIN_POINTS) return false;
  const half = Math.max(1, Math.round(n / 60));
  const s = r.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += r[k]!;
    return sum / (hi - lo + 1);
  });
  const sigma = 1.4826 * median(r.map((v, i) => Math.abs(v - s[i]!)));
  const top = Math.max(...s);
  if (!(top > (4 * sigma) / Math.sqrt(2 * half + 1))) return false;
  if (-Math.min(...s) > 0.3 * top) return false;
  let runs = 0;
  let longest = 0;
  for (let i = 0; i < n; ) {
    if (s[i]! < top / 2) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && s[j]! >= top / 2) j++;
    runs++;
    longest = Math.max(longest, j - i);
    i = j;
  }
  return runs === 1 && longest <= n / 4;
}
