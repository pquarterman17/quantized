// The auto title of a Y axis that carries several series. The export leg is
// `calc/figure_labels.shared_axis_title`; both read the cases in
// `tests/fixtures/wire/shared_axis_title.json`.
import { displayUnit } from "./unitDisplay";

/** The quantity and unit every series shares ("Moment (emu)"), else the
 *  shared unit alone ("(emu)"), else undefined (the legend names them). Reads
 *  the DATA's label/unit, never a legend rename. */
export function sharedAxisTitle(series: readonly { label: string; unit?: string }[]): string | undefined {
  const unit = series[0]?.unit ?? "";
  if (series.every((s) => (s.unit ?? "") === unit)) {
    const label = series.every((s) => s.label === series[0].label) ? series[0]?.label : "";
    return (unit ? `${label} (${displayUnit(unit)})`.trim() : label) || undefined;
  }
}

/** The series a Y axis' auto title is read from: those on axis `which`
 *  that are DRAWN (re-audit #13: a hidden error column on the axis blanked
 *  the title, or left only "(unit)"), or every one on it when none is drawn.
 *  The export receives only drawn series, so this is what it titles too. */
export function drawnOnAxis(
  series: readonly { axis?: number }[],
  hidden: readonly boolean[] | null | undefined,
  which: number,
): number[] {
  const onAxis = series.map((_, i) => i).filter((i) => (series[i].axis ?? 0) === which);
  const drawn = onAxis.filter((i) => !hidden?.[i]);
  return drawn.length ? drawn : onAxis;
}
