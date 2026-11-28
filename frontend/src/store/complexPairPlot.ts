// Argand and Nyquist plots of a real / imaginary column pair (lib/complexPair.ts):
// the plot menu's two entries, loaded on first use. Argand is Im against Re.
// Nyquist is -Im against Re, so it needs a column that holds -Im: an ordinary
// computed column `-<the Im column>` named `<base> (-im)`, added once (a second
// request finds it) and then following any later edit of the Im column.

import { complexPairById, negatedImaginary } from "../lib/complexPair";
import { addDerivedColumn } from "./derivedColumnRun";
import { useApp } from "./useApp";

export type PairPlotKind = "argand" | "nyquist";

/** `setXKey` / `setYKeys` are the worksheet view's (they claim the plot first). */
export interface PairPlotAxes {
  setXKey: (col: number) => void;
  setYKeys: (cols: number[]) => void;
}

/** True once the plot is set; a refusal says why in the status line and returns false. */
export async function plotComplexPair(dsId: string, pairId: string, kind: PairPlotKind, axes: PairPlotAxes): Promise<boolean> {
  const get = useApp.getState;
  const refuse = (why: string): false => {
    get().setStatus(`Can't plot the pair: ${why}`, "danger");
    return false;
  };
  const ds = get().datasets.find((d) => d.id === dsId);
  if (!ds) return refuse("that worksheet is no longer open");
  const pair = complexPairById(ds, pairId);
  if (typeof pair === "string") return refuse(pair);
  let y = pair.im;
  if (kind === "nyquist") {
    const neg = negatedImaginary(pair);
    const have = ds.formulas?.find((f) => f.expr.trim() === neg.expr && ds.data.labels.includes(f.name));
    if (!have && ds.data.labels.includes(neg.name)) return refuse(`a column named "${neg.name}" already exists`);
    if (!have) {
      const r = await addDerivedColumn(dsId, { ...neg, propagate: false });
      if (!r.ok) return refuse(r.error);
    }
    const now = get().datasets.find((d) => d.id === dsId);
    y = now?.data.labels.indexOf(have?.name ?? neg.name) ?? -1;
    if (y < 0) return refuse("the -Im column is missing");
  }
  axes.setXKey(pair.re);
  axes.setYKeys([y]);
  get().setStatus(kind === "argand" ? "Argand plot: Im against Re" : "Nyquist plot: -Im against Re");
  return true;
}
