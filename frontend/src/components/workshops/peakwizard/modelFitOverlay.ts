// Peak Analyzer — map a model-fit curve back onto the plot (audit P2.4
// slice 2). Pure. The fit runs on the wizard's WORKING trace (range-cut,
// gap-dropped, baseline-subtracted), so a curve drawn on the raw plot must
// add the step-① baseline back — the same correction `plotApexY` applies to
// the peak markers (lib/peakWizardApex.ts).
//
// Rows are matched by X VALUE, not by index: the fit's points are a subset of
// the plotted rows (range cut, gap rows, and `analysisData`'s excluded rows
// all drop out), and every model curve is a function of x, so the exact x
// the backend echoes back (JSON round-trips a double exactly) is the only
// key that cannot misalign. A plotted row the fit never saw draws nothing.

export function fullRowOverlay(
  fullX: readonly number[],
  curveX: readonly (number | null)[],
  values: readonly (number | null)[],
  offsetByX: ReadonlyMap<number, number> | null,
): (number | null)[] {
  const byX = new Map<number, number>();
  curveX.forEach((x, i) => {
    const v = values[i];
    if (x === null || v === null || v === undefined || byX.has(x)) return;
    byX.set(x, v + (offsetByX?.get(x) ?? 0));
  });
  return fullX.map((x) => byX.get(x) ?? null);
}

/** x -> the step-① baseline value there, for `fullRowOverlay`'s offset. A
 *  null baseline point was passed through uncorrected (subtractBaseline), so
 *  it maps to no offset. */
export function baselineOffsets(
  x: readonly number[],
  baseline: readonly (number | null)[],
): Map<number, number> {
  const m = new Map<number, number>();
  x.forEach((xi, i) => {
    const b = baseline[i];
    if (typeof b === "number" && Number.isFinite(b) && !m.has(xi)) m.set(xi, b);
  });
  return m;
}
