// The real / imaginary column pair Set Column Values writes from ONE complex
// expression (plan item 33; plans/COMPLEX_FORMULA_CONTRACT.md "Not in this
// slice", pair metadata). The two computed columns carry `pair: { id, part }`;
// that mark is the whole of the metadata, and only the worksheet's plot menu
// ("Argand plot", "Nyquist plot") reads it.
//
// Fail closed: a mark alone proves nothing, because the user may edit one
// column afterwards. A pair is offered only while BOTH columns exist, one is
// `re(E)` and the other `im(E)` of the very same expression E over the very
// same row range, and nothing else carries that id. Any other pair of
// columns, however it is named or laid out, is an ordinary pair.

import { channelLetter } from "./formula";
import { sameFormula, unwrapRange } from "./setColumnValues";
import type { Dataset } from "./types";

export interface ComplexPair {
  id: string;
  /** Channel indices of the real and the imaginary column. */
  re: number;
  im: number;
  /** The imaginary column's name without its " (im)" suffix: the base of the names a plot adds. */
  base: string;
}

const PART = /^\s*(re|im)\b/;

/** The pair `id` names in `ds`, or why there is none. */
export function complexPairById(ds: Dataset, id: string): ComplexPair | string {
  const marked = (ds.formulas ?? []).filter((f) => f.pair?.id === id);
  const re = marked.filter((f) => f.pair?.part === "re");
  const im = marked.filter((f) => f.pair?.part === "im");
  if (marked.length !== 2 || re.length !== 1 || im.length !== 1) return "that pair of columns is incomplete";
  const [iRe, iIm] = [ds.data.labels.indexOf(re[0].name), ds.data.labels.indexOf(im[0].name)];
  if (iRe < 0 || iIm < 0) return "that pair of columns is incomplete";
  const [a, b] = [unwrapRange(re[0].expr), unwrapRange(im[0].expr)];
  const same =
    PART.exec(a.expr)?.[1] === "re" && PART.exec(b.expr)?.[1] === "im" && a.from === b.from && a.to === b.to && sameFormula(a.expr, b.expr.replace(PART, "re"));
  if (!same) return "the two columns no longer come from one complex expression (one was edited)";
  return { id, re: iRe, im: iIm, base: im[0].name.replace(/ \(im\)$/, "") };
}

/** The name and formula of the column that holds -Im: the Nyquist convention plots -Z'' against Z'. */
export function negatedImaginary(pair: ComplexPair): { name: string; expr: string } {
  return { name: `${pair.base} (-im)`, expr: `-${channelLetter(pair.im)}` };
}

/** Which pair the Plot menu / palette entries act on, from the plot's chosen columns (`xKey`, `yKeys`; null = the
 *  default): the pair one of them belongs to, or, with nothing chosen, the worksheet's only pair. Fail closed: a
 *  chosen column that is no pair half, two columns of different pairs, or several pairs and no choice refuse, each
 *  with its reason. The full re(E) / im(E) check is `complexPairById`'s, run when the plot is made. */
export function pairIdForSelection(ds: Dataset, xKey: number | null, yKeys: readonly number[] | null): { id: string } | { error: string } {
  const formulas = (ds.formulas ?? []).filter((f) => f.pair && ds.data.labels.includes(f.name));
  const all = [...new Set(formulas.map((f) => f.pair!.id))];
  if (all.length === 0) return { error: "this worksheet has no real / imaginary column pair (Set column values writes one: Write the real and imaginary parts as two columns)" };
  const chosen = [...(xKey === null || xKey < 0 ? [] : [xKey]), ...(yKeys ?? [])];
  if (chosen.length === 0) return all.length === 1 ? { id: all[0] } : { error: `this worksheet has ${all.length} real / imaginary pairs: set one of a pair's columns as X or Y to choose` };
  const ids = new Set(chosen.map((c) => formulas.find((f) => f.name === ds.data.labels[c])?.pair?.id));
  if (ids.has(undefined)) return { error: "the plotted columns are not a real / imaginary pair written by Set column values" };
  if (ids.size !== 1) return { error: "the plotted columns belong to different real / imaginary pairs" };
  return { id: [...ids][0]! };
}
