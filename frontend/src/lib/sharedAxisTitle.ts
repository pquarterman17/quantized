// The auto title of a Y axis that carries several series. The export leg is
// `calc/figure_labels.shared_axis_title`; both read the cases in
// `tests/fixtures/wire/shared_axis_title.json`.
import { displayUnit } from "./unitDisplay";

/** More distinct names than this in one unit group end in "…". */
const MAX_NAMES = 3;

/** A JOINT title over the series' DATA labels and units (origin gap audit 2
 *  #11: a mixed-unit axis used to get no title, a shared unit only "(unit)").
 *  Series are grouped by unit in first-appearance order; each group names its
 *  distinct quantities ("R1, R2 (ohm)"; past three, "a, b, c, … (emu)"), and
 *  groups are joined with " / " ("Resistance (ohm) / Voltage (V)"). Every
 *  series sharing one quantity and unit keeps the plain "Moment (emu)".
 *  Never reads a legend rename. Undefined for no series. */
export function sharedAxisTitle(series: readonly { label: string; unit?: string }[]): string | undefined {
  const groups = new Map<string, string[]>();
  for (const s of series) {
    const names = groups.get(s.unit ?? "") ?? [];
    if (!names.includes(s.label)) names.push(s.label);
    groups.set(s.unit ?? "", names);
  }
  const parts = [...groups].map(([unit, names]) => {
    const shown = names.filter(Boolean);
    const quantity = shown.length > MAX_NAMES ? `${shown.slice(0, MAX_NAMES).join(", ")}, …` : shown.join(", ");
    return unit ? `${quantity} (${displayUnit(unit)})`.trim() : quantity;
  });
  return parts.filter(Boolean).join(" / ") || undefined;
}

/** A display series that is not a curve of its own: a companion (the grey
 *  "(excluded)" or accent "(selected)" points, a fit band edge) or an analysis
 *  overlay (fit, baseline, peaks, dy/dx). It never names an axis. */
type AxisSeries = { axis?: number; muted?: boolean; selected?: boolean; band?: number; overlay?: boolean };
const isCompanion = (s: AxisSeries) => !!(s.muted || s.selected || s.band || s.overlay);

/** The series a Y axis' auto title is read from: the CURVES on axis `which`
 *  that are DRAWN (re-audit #13: a hidden error column on the axis blanked
 *  the title, or left only "(unit)"), or every curve on it when none is drawn.
 *  Companions and overlays never count (gap audit 2 #11: a "(selected)"
 *  companion reduced "R1 (ohm)" to "(ohm)"). The export receives only drawn
 *  series, so this is what it titles too. */
export function drawnOnAxis(series: readonly AxisSeries[], hidden: readonly boolean[] | null | undefined, which: number): number[] {
  const onAxis = series.map((_, i) => i).filter((i) => (series[i].axis ?? 0) === which && !isCompanion(series[i]));
  const drawn = onAxis.filter((i) => !hidden?.[i]);
  return drawn.length ? drawn : onAxis;
}
