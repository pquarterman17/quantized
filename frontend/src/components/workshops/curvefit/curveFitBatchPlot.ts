// Curve Fit batch -- "Plot ▸ parameter": open a batch summary worksheet with
// ONE fitted parameter on Y and R² on the right axis, against the summary X
// (Origin's "Plot Parameters"). Summary columns are fixed by `batchColumns`:
// Levels, Completed, N, R², Reduced χ², RMSE, then value and SE per parameter.

const FIRST_PARAM_COLUMN = 6;

/** The fitted parameters of a run, as chip labels with their value column. */
export function batchParamColumns(columns: readonly string[]): { name: string; column: number }[] {
  const out: { name: string; column: number }[] = [];
  for (let c = FIRST_PARAM_COLUMN; c < columns.length; c += 2) out.push({ name: columns[c]!, column: c });
  return out;
}
