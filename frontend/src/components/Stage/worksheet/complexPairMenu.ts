// "Argand plot" / "Nyquist plot" for a real / imaginary column pair written by
// Set Column Values from one complex expression (lib/complexPair.ts). Offered
// on a header right-click of either half, and ONLY on a column that carries the
// pair mark with its partner present: an ordinary pair of columns gets nothing.
// The full check (both formulas still one expression) and the plot itself load
// on click.

import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import type { Dataset } from "../../../lib/types";
import type { ContextMenuItem } from "../../overlays/ContextMenu";
import type { WorksheetView } from "./useWorksheetView";

export function complexPairItems(ds: Dataset, col: number, view: WorksheetView): ContextMenuItem[] {
  const id = ds.formulas?.find((f) => f.name === ds.data.labels[col])?.pair?.id;
  if (!id || ds.formulas?.filter((f) => f.pair?.id === id).length !== 2) return [];
  const plot = (kind: "argand" | "nyquist") => () =>
    void runLazy("Loading plot…", () => import("../../../store/complexPairPlot")).then((m) => m.plotComplexPair(ds.id, id, kind, view), onLoadFailure);
  return [{ separator: true }, { label: "Argand plot (Im vs Re)", run: plot("argand") }, { label: "Nyquist plot (−Im vs Re)", run: plot("nyquist") }];
}
