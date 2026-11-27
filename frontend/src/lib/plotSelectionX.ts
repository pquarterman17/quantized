// "Plot selection" with only Y columns selected (plan item 43, sub-task B).
// Until now the selection left the plot's X alone, so a Y chosen from an
// Origin-style book (X1 Y1 X2 Y2) was drawn against whatever X the last plot
// used. The sheet's designated X columns now decide:
//  - one X owns every selected Y (the nearest X before it, or the sheet's only
//    X) -> it is used, with no question asked;
//  - the selected Ys belong to different X columns, or one precedes every X of
//    a sheet that has several -> the role picker opens (lib/plotSetup.ts),
//    never a guess;
//  - the sheet designates no X, or the selection names its own X, or the user
//    has set an X of their own by hand -> exactly what Plot selection did before.
// Lazy: only the worksheet's plot command reaches it.

import { effectiveDesignations } from "./columnmeta";
import { resolveSelectionPlot, type SelectionPlotAxis, type SelectionPlotResult } from "./selectionplot";
import { openFigureDialog } from "../store/figureDialogs";
import type { Dataset } from "./types";

export type SelectionX = { kind: "keep" } | { kind: "x"; xKey: number } | { kind: "ask" };

/** Which X the selected Y columns belong to. `current` is the plot's X: an X
 *  the user set on a non-designated column is theirs, and stands. */
export function selectionXDecision(ds: Dataset, selected: ReadonlySet<number>, current: SelectionPlotAxis): SelectionX {
  const desig = effectiveDesignations(ds.data, ds.columnDesignations);
  const cols = [...selected].filter((c) => c >= 0);
  if (selected.has(-1) || cols.some((c) => desig[c] === "X")) return { kind: "keep" };
  const ys = cols.filter((c) => {
    const d = desig[c];
    return d === undefined || d === "Y" || d === "Z";
  });
  const xs = desig.flatMap((d, c) => (d === "X" ? [c] : []));
  if (ys.length === 0 || xs.length === 0) return { kind: "keep" };
  if (current.xKey !== null && !xs.includes(current.xKey)) return { kind: "keep" };
  const owner = (y: number): number | undefined => xs.filter((x) => x < y).pop() ?? (xs.length === 1 ? xs[0] : undefined);
  const owners = new Set(ys.map(owner));
  if (owners.size !== 1 || owners.has(undefined)) return { kind: "ask" };
  return { kind: "x", xKey: [...owners][0]! };
}

/** `resolveSelectionPlot` plus the X decision above. Returns null after
 *  opening the role picker (seeded with the selection) when the X is
 *  ambiguous; the caller then does nothing more. */
export function planSelectionPlot(
  ds: Dataset,
  cols: readonly number[],
  current: SelectionPlotAxis,
  mode: "replace" | "add",
): SelectionPlotResult | null {
  const selected = new Set(cols);
  const decision = selectionXDecision(ds, selected, current);
  if (decision.kind === "ask") {
    openFigureDialog({ kind: "plotSetup", seed: { datasetId: ds.id, cols, mode } });
    return null;
  }
  const xKey = decision.kind === "x" ? decision.xKey : current.xKey;
  const base = resolveSelectionPlot(ds.data, selected, { ...current, xKey }, mode);
  if (xKey === current.xKey || !base.actions.some((a) => a.kind === "setYKeys")) return base;
  const name = ds.data.labels[xKey!] ?? `column ${xKey! + 1}`;
  return {
    actions: [{ kind: "setXKey", xKey }, ...base.actions],
    summary: `${base.summary}, X: ${name}`,
  };
}
