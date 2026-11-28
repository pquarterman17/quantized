// Plot ▸ Layout ▸ "Argand plot" and "Nyquist plot" (plan item 33): the plot of the real / imaginary
// column pair Set Column Values writes from one complex expression, also in the worksheet's column
// menu. The pair is the one the plotted columns belong to, or the worksheet's only pair
// (lib/complexPair.ts pairIdForSelection). Part of the full command list (appCommands.ts, through buildEditDataExtras), not the
// startup one; the body loads on use (store/complexPairPlotCommand.ts), which refuses with its
// reason for a selection that is not a marked pair. The entries are off with a reason while the
// active worksheet has no pair at all.

import type { StoreGet } from "../lib/exportActive";
import { onLoadFailure, runLazy } from "../lib/runLazy";
import type { Action } from "../store/commands";

const NO_PAIR = "Needs a real / imaginary column pair: Set column values ▸ Write the real and imaginary parts as two columns";

export function buildComplexPairCommands(s: StoreGet): Action[] {
  const none = () => !s().datasets.find((d) => d.id === s().activeId)?.formulas?.some((f) => f.pair);
  return (["argand", "nyquist"] as const).map((kind) => ({
    id: `${kind}-plot`,
    group: "Plot",
    section: "Layout",
    label: kind === "argand" ? "Argand plot (imaginary vs real)" : "Nyquist plot (−imaginary vs real)",
    description: `Plot the real / imaginary column pair of a complex formula with ${kind === "argand" ? "Im on Y against Re on X" : "−Im on Y against Re on X, through an added −Im column"}.`,
    keywords: "impedance complex real imaginary phasor re im pair z",
    disabled: none,
    disabledReason: NO_PAIR,
    run: () => void runLazy("Loading plot…", () => import("../store/complexPairPlotCommand")).then((m) => m.plotPairFromSelection(kind), onLoadFailure),
  }));
}
