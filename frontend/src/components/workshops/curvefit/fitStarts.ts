// Curve Fit — the parameter table parsed for a fit on these (x, y), with the
// data-driven guess filling every start the user did not choose
// (lib/fitParams `autoStartRows`). Shared by the single fit and the batch so an
// edited table means the same thing in both. One /guess request, and only
// when the table is edited AND has such a row: an untouched table sends no
// starts at all and the route guesses them itself.

import { autoGuess } from "../../../lib/api/curvefit";
import { autoStartRows, parseFitParams, rowsAreDefault, type FitParamRow, type ParsedFitParams } from "../../../lib/fitParams";
import type { FitModel } from "../../../lib/types";

export async function parseFitStarts(
  rows: readonly FitParamRow[],
  model: FitModel | undefined,
  modelName: string,
  x: number[],
  y: number[],
): Promise<ParsedFitParams> {
  const edited = !rowsAreDefault(rows, model);
  const guess = edited && autoStartRows(rows, model).length > 0 ? (await autoGuess(modelName, x, y)).p0 : undefined;
  return parseFitParams(rows, model, guess);
}
