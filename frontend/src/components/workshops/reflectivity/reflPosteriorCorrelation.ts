import type { SavedPosterior } from "./reflPosterior";

export const POSTERIOR_CORRELATION_THRESHOLD = 0.7;
export const POSTERIOR_CORRELATION_GRID_LIMIT = 30;

export interface PosteriorCorrelationPair {
  first: string;
  second: string;
  r: number;
}

export interface PosteriorCorrelationDiagnostic {
  labels: string[];
  matrix: (number | null)[][];
  pairs: PosteriorCorrelationPair[];
  issue: string | null;
}

const validCoefficient = (value: number | null): boolean =>
  value === null || (Number.isFinite(value) && value >= -1.000001 && value <= 1.000001);

function matrixIsCorrelation(matrix: readonly (readonly (number | null)[])[]): boolean {
  for (let row = 0; row < matrix.length; row++) {
    const diagonal = matrix[row][row];
    if (diagonal === null || Math.abs(diagonal - 1) > 1e-6) return false;
    for (let column = row + 1; column < matrix.length; column++) {
      const forward = matrix[row][column], reverse = matrix[column][row];
      if ((forward === null) !== (reverse === null) ||
          (forward !== null && reverse !== null && Math.abs(forward - reverse) > 1e-6)) return false;
    }
  }
  return true;
}

/** Validate the stored matrix and rank parameter trade-offs without guessing
 * labels. The backend's `free` order is authoritative because tied parameters
 * appear in the interval table but are not independent matrix axes. */
export function posteriorCorrelationDiagnostic(
  posterior: Pick<SavedPosterior, "free" | "correlation">,
): PosteriorCorrelationDiagnostic {
  const labels = posterior.free;
  const matrix = posterior.correlation;
  if (labels.length === 1 && matrix.length === 1 && matrix[0].length === 1 && matrix[0][0] !== null &&
      Math.abs(matrix[0][0] - 1) <= 1e-6) {
    return { labels: [], matrix: [], pairs: [], issue: "Only one parameter was free, so there are no pairwise parameter correlations." };
  }
  // levels-allowlist: these are backend free-parameter identifiers whose
  // uniqueness makes a square matrix unambiguous, not category levels.
  if (labels.length < 2 || matrix.length !== labels.length || new Set(labels).size !== labels.length ||
      matrix.some((row) => row.length !== labels.length || row.some((value) => !validCoefficient(value))) ||
      !matrixIsCorrelation(matrix)) {
    return { labels: [], matrix: [], pairs: [], issue: "Parameter correlation is unavailable for this saved run. Re-estimate uncertainty to regenerate it." };
  }
  const pairs: PosteriorCorrelationPair[] = [];
  for (let row = 0; row < labels.length; row++) {
    for (let column = row + 1; column < labels.length; column++) {
      const r = matrix[row][column];
      if (r !== null && Number.isFinite(r)) pairs.push({ first: labels[row], second: labels[column], r });
    }
  }
  pairs.sort((left, right) => Math.abs(right.r) - Math.abs(left.r) ||
    left.first.localeCompare(right.first) || left.second.localeCompare(right.second));
  return { labels: [...labels], matrix: matrix.map((row) => [...row]), pairs, issue: null };
}
