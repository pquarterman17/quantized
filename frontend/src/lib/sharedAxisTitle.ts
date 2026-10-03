// The auto title of a Y axis that carries several series. The export leg is
// `calc/figure_labels.shared_axis_title`; both read the cases in
// `tests/fixtures/wire/shared_axis_title.json`.

/** The quantity and unit every series shares ("Moment (emu)"), else the
 *  shared unit alone ("(emu)"), else undefined (the legend names them). Reads
 *  the DATA's label/unit, never a legend rename. */
export function sharedAxisTitle(series: readonly { label: string; unit?: string }[]): string | undefined {
  const [first] = series;
  const unit = first?.unit ?? "";
  if (!first || series.some((s) => (s.unit ?? "") !== unit)) return undefined;
  const label = series.every((s) => s.label === first.label) ? first.label : "";
  return (unit ? `${label} (${unit})`.trim() : label) || undefined;
}
