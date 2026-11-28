// The worksheet's "Extract rows…" entry points (toolbar button, row-number gutter menu) call this: it loads the
// question flow (`extractRowsAsk`, with its dialog) the first time it is used, so a worksheet that never asks pays nothing.

import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import { useApp } from "../../../store/useApp";

export function extractRowsAsking(datasetId: string, selected: ReadonlySet<number>): void {
  void runLazy("Loading Extract rows…", () => import("./extractRowsAsk")).then((m) => m.extractRowsAsking(datasetId, selected, useApp.getState), onLoadFailure);
}
