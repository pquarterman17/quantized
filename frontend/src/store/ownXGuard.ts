// The one-X plot never draws a Y against an X it does not belong to.
//
// A book can give a Y its own X column (Origin's X,Y,X,Y sheets, or a user's
// "Set As X": lib/ownXSeries.ts). The live plot has ONE X, so such a Y starts
// hidden (lib/errorbars.ts's `bookDefaultHiddenChannels`). Hidden channels are
// toggleable, though, and un-hiding one drew it against the plot's X -- the
// book's first -- which is simply the wrong plot. `heldOwnX` is the test the
// visibility actions (store/plotViewSettings.ts) ask before un-hiding, and
// `plotOwnXInstead` is what they do instead: say why, and open the plot that
// draws every Y against its own X (Quick Plot's per-series-X seed, or the
// Quick Figure Builder for generic data -- store/quickPlotRun.ts).
//
// A Y whose own X IS the plot's current X (the user chose "Set as X axis" on
// that column) is not held: there it is exactly the right plot.

import { effectiveDesignations } from "../lib/columnmeta";
import { ownXSeries } from "../lib/ownXSeries";
import { onLoadFailure, runLazy } from "../lib/runLazy";
import type { AppState } from "./useApp";

type OwnXState = Pick<AppState, "datasets" | "activeId" | "xKey">;

/** The X column `channel` belongs to when it is NOT the live plot's X, else
 *  null (the channel may be drawn). */
export function heldOwnX(s: OwnXState, channel: number): number | null {
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds) return null;
  const x = ownXSeries(effectiveDesignations(ds.data, ds.columnDesignations))[channel];
  return x === undefined || x === s.xKey ? null : x;
}

/** The status line for a refused un-hide. */
export function ownXStatus(s: OwnXState, channel: number, x: number): string {
  const labels = s.datasets.find((d) => d.id === s.activeId)?.data.labels ?? [];
  const name = (c: number) => labels[c] ?? `column ${c + 1}`;
  return `"${name(channel)}" belongs to the X column "${name(x)}", not this plot's X — plotting each Y against its own X instead`;
}

/** Open the per-series-X plot of the active dataset. */
export function plotOwnXInstead(datasetId: string): void {
  void runLazy("Loading Quick Plot…", () => import("./quickPlotRun")).then(
    (m) => m.plotEachAgainstOwnX(datasetId),
    onLoadFailure,
  );
}
