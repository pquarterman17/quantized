// "Show formulas" (Excel's Ctrl+`): a VIEW of one worksheet window that draws each formula cell's
// text where its value would be. Nothing is written, so nothing is undoable and nothing is saved:
// like the Stats footer, the toggle is per window and is not persisted (the other per-window view
// toggles are not either; hidden and frozen columns are the persisted ones, because they are
// per-sheet properties).
//
// The text is exactly what Set Column Values shows in its formula box for that column: the stored
// expression with a row-range wrapper taken off (`unwrapRange`), a `let` as the user typed it, a
// named range as `rng("Name")`. A column with no expression (a recode, a factor, derived σ) has no
// text to show and keeps its values.

import { useMemo, useState } from "react";

import { unwrapRange } from "../../../lib/setColumnValues";
import type { Dataset } from "../../../lib/types";
import type { CellFormatter } from "./cellFormat";

/** A formula column's text, and the 1-based rows it covers (blank bounds = the first / last row). */
export interface FormulaText { text: string; from: number; to: number }

/** Formula text by column index, for the computed columns that have an expression. */
export function formulaTextByColumn(ds: Dataset): Record<number, FormulaText> {
  const base = ds.data.labels.length - (ds.formulas?.length ?? 0);
  const out: Record<number, FormulaText> = {};
  (ds.formulas ?? []).forEach((f, i) => {
    if (f.expr.trim() && !f.recode) {
      const u = unwrapRange(f.expr);
      out[base + i] = { text: u.expr, from: u.from === "" ? 1 : Number(u.from), to: u.to === "" ? Infinity : Number(u.to) };
    }
  });
  return out;
}

/** `fmtOf` with each formula column drawn as its text, on the rows the formula covers only: a
 *  range-limited column keeps its own (blank) cells outside the range. */
export function withFormulaText(fmtOf: (col: number) => CellFormatter, text: Record<number, FormulaText> | undefined): (col: number) => CellFormatter {
  if (!text) return fmtOf;
  return (col) => {
    const t = text[col];
    if (t === undefined) return fmtOf(col);
    const own = fmtOf(col);
    return (v, row) => (row === undefined || (row + 1 >= t.from && row + 1 <= t.to) ? t.text : own(v, row));
  };
}

export interface ShowFormulas {
  on: boolean;
  toggle: () => void;
  /** The text to draw, or undefined while the view is off. */
  cells: Record<number, FormulaText> | undefined;
}

export function useShowFormulas(ds: Dataset): ShowFormulas {
  const [on, setOn] = useState(false);
  const cells = useMemo(() => (on ? formulaTextByColumn(ds) : undefined), [on, ds]);
  return { on, toggle: () => setOn((v) => !v), cells };
}
