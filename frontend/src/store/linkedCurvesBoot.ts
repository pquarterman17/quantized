// Installs the live-graph sync (store/linkedCurvesSync.ts, a lazy chunk) the
// first time the workspace holds a graph -- one created this session, or one
// a loaded/restored workspace brought in. Startup pays only this check.

import { onLoadFailure, runLazy } from "../lib/runLazy";
import { useApp, type AppState } from "./useApp";

let booted = false;

function check(s: Pick<AppState, "datasets">): void {
  if (booted || !s.datasets.some((d) => d.linkedCurves)) return;
  booted = true;
  void runLazy("Loading graph links…", () => import("./linkedCurvesSync")).then((m) => m.installLinkedCurvesSync(), onLoadFailure);
}

export function bootLinkedCurves(): void {
  check(useApp.getState());
  useApp.subscribe(check);
}
