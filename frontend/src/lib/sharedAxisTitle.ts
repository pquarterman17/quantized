// The auto title of a Y axis that carries several series. The export leg is
// `calc/figure_labels.shared_axis_title`; both read the cases in
// `tests/fixtures/wire/shared_axis_title.json`.

/** The quantity and unit every series shares ("Moment (emu)"), else the
 *  shared unit alone ("(emu)"), else undefined (the legend names them). Reads
 *  the DATA's label/unit, never a legend rename. */
export function sharedAxisTitle(series: readonly { label: string; unit?: string }[]): string | undefined {
  if (series.length === 0) return undefined;
  const { label, unit = "" } = series[0];
  if (series.some((s) => (s.unit ?? "") !== unit)) return undefined;
  if (series.every((s) => s.label === label)) return unit ? `${label} (${unit})` : label || undefined;
  return unit ? `(${unit})` : undefined;
}
