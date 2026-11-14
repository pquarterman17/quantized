// The auto title of a Y axis that carries several series (gap audit 2 #11: joint over mixed units). The export leg is
// `calc/figure_labels.shared_axis_title`; both read the cases in
// `tests/fixtures/wire/shared_axis_title.json`.
import { displayUnit } from "./unitDisplay";

/** Most quantities a joint title names per unit before it says "(unit)" alone. */
export const JOINT_TITLE_MAX = 3;

/** The axis' auto title, joint over what its series carry (gap audit 2 #11):
 *  one "quantity, quantity (unit)" group per unit in first-seen order --
 *  "Moment (emu)", "R1, R2 (ohm)", "M (emu), T (K)" -- a group naming more
 *  than `JOINT_TITLE_MAX` quantities says only "(unit)". Undefined for no
 *  series. Reads the DATA's label/unit, never a legend rename. */
export function sharedAxisTitle(series: readonly { label: string; unit?: string }[]): string | undefined {
  const groups = new Map<string, string[]>();
  for (const s of series) {
    const labels = groups.get(s.unit ?? "") ?? [];
    if (!labels.includes(s.label)) labels.push(s.label);
    groups.set(s.unit ?? "", labels);
  }
  const parts = [...groups].map(([unit, labels]) => {
    const names = labels.length > JOINT_TITLE_MAX ? "" : labels.filter(Boolean).join(", ");
    return (unit ? `${names} (${displayUnit(unit)})` : names).trim();
  });
  return parts.filter(Boolean).join(", ") || undefined;
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
