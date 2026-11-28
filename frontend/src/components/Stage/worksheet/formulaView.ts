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

/** Formula text by column index, for the computed columns that have an expression. */
export function formulaTextByColumn(ds: Dataset): Record<number, string> {
  const base = ds.data.labels.length - (ds.formulas?.length ?? 0);
  const out: Record<number, string> = {};
  (ds.formulas ?? []).forEach((f, i) => {
    if (f.expr.trim() && !f.recode) out[base + i] = unwrapRange(f.expr).expr;
  });
  return out;
}

/** `fmtOf` with each formula column drawn as its text. */
export function withFormulaText(fmtOf: (col: number) => CellFormatter, text: Record<number, string> | undefined): (col: number) => CellFormatter {
  if (!text) return fmtOf;
  return (col) => {
    const t = text[col];
    return t === undefined ? fmtOf(col) : () => t;
  };
}

export interface ShowFormulas {
  on: boolean;
  toggle: () => void;
  /** The text to draw, or undefined while the view is off. */
  cells: Record<number, string> | undefined;
}

export function useShowFormulas(ds: Dataset): ShowFormulas {
  const [on, setOn] = useState(false);
  const cells = useMemo(() => (on ? formulaTextByColumn(ds) : undefined), [on, ds]);
  return { on, toggle: () => setOn((v) => !v), cells };
}
