// Color-by on the categorical marks (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4 residual
// 3): a box / violin / strip glyph or a bar is coloured by its LEVEL of the
// colour column, through the same palette cycle the XY encodings use
// (`SERIES_VARS[level % 8]`, `lib/plotEncoding`), so one level has one colour
// in every panel and in every mark family.
//
// THE RULE. The colour column is always one of the plot's own category
// factors — the group column (`part` 0) or the nested "then by" column
// (`part` 1) — so every glyph sits at exactly one of its levels and nothing
// has to split again. The Graph Builder makes it so when it sends a Color pick
// to the Stat Stage (`lib/plotEncodingStat`): Color on X colours by X; Color on
// another column nests X by it. The level index is the column's position in
// `categoryLevels` over the dataset's FULL rows (the user's level order), so
// hiding, excluding or faceting never changes a level's colour.
//
// The Stat Stage reads a glyph's level off its axis slot's key (`lib/groupAxis`:
// `"a"` or `"a|b"`, the codes), so empty and hidden slots can never shift it;
// the export receives the levels resolved per group (`color_levels`) plus the
// palette as hex (`plotEncodingBinding.resolvedPalette`), and the backend
// colours group `i` `palette[level % len]` (`calc.figure_stat_colors`).

import { categoryLevels } from "./categorical";
import type { AxisSlot } from "./groupAxis";
import { seriesColor } from "./seriesStyleCycle";
import type { DataStruct } from "./types";

export interface StatColor {
  /** The colour column. */
  col: number;
  /** Which part of an axis slot key carries its code: 0 group, 1 nest. */
  part: 0 | 1;
  /** `categoryLevels(full rows, col)`: a code's index is its colour level. */
  levels: readonly number[];
}

/** The colour factor of a stat plot grouped by `groupCol` (then `group2Col`),
 *  or null when `colorCol` is unset or is neither factor (a stale pick). */
export function statColorOf(
  full: DataStruct,
  colorCol: number | null,
  groupCol: number | null,
  group2Col: number | null,
): StatColor | null {
  if (colorCol == null || groupCol == null) return null;
  const part = colorCol === groupCol ? 0 : colorCol === group2Col ? 1 : null;
  return part === null ? null : { col: colorCol, part, levels: categoryLevels(full, colorCol) };
}

/** The colour level of the code `code` (null: no such level). */
export function codeLevel(c: StatColor, code: number | undefined): number | null {
  const k = code === undefined ? -1 : c.levels.indexOf(code);
  return k < 0 ? null : k;
}

/** An axis slot's colour level, read off its key (`"a"` / `"a|b"`). */
export function slotColorLevel(c: StatColor, key: string | undefined): number | null {
  const part = key?.split("|")[c.part];
  return part === undefined || part.startsWith("ch:") ? null : codeLevel(c, Number(part));
}

/** Per PLOTTED group (`slot.group`), its colour level, from the aligned axis. */
export function groupColorLevels(c: StatColor, aligned: readonly AxisSlot[], groupCount: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(groupCount).fill(null);
  for (const s of aligned) if (s.group !== null) out[s.group] = slotColorLevel(c, s.key);
  return out;
}

/** The fill of glyph `i`: its level's palette colour, else its position's. */
export function glyphColor(levels: readonly (number | null)[] | null | undefined, i: number): string {
  return seriesColor(levels?.[i] ?? i);
}
