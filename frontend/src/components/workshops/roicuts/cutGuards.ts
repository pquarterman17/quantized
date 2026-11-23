// ROI cuts workshop: the refusals that run BEFORE a request is built. Each
// returns the user-facing reason a cut cannot run (or null), so a Run / Stats
// press with no box, no dataset or a non-finite bound says why instead of
// doing nothing or sending `null` bounds that the backend can only 422.

import type { RoiRect } from "../../../lib/roi";
import type { Dataset } from "../../../lib/types";

export const NO_BOX_REASON = "Set the box bounds first: edit a bound or draw a box on the map.";
export const NO_DATASET = "Select a 2-D map dataset first.";

export function boxProblem(active: Dataset | null, rect: RoiRect | null): string | null {
  if (!active) return NO_DATASET;
  if (!rect) return NO_BOX_REASON;
  if (![rect.x0, rect.x1, rect.y0, rect.y1].every(Number.isFinite)) {
    return "The box has a bound that is not a finite number. Nothing was cut.";
  }
  return null;
}

export function sectorProblem(active: Dataset | null, fields: readonly number[]): string | null {
  if (!active) return NO_DATASET;
  if (!fields.every(Number.isFinite)) {
    return "The sector has a bound or bin count that is not a finite number. Nothing was cut.";
  }
  return null;
}
