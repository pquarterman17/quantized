// The Library's and the result workspace's ONE seam into the lazy-only
// store/analysisResultActions.ts: `runLazy` gives the chunk load a busy entry
// and the standard error toast, so the eager entry never imports the actions.

import { onLoadFailure, runLazy } from "../lib/runLazy";

export type AnalysisResultActions = typeof import("./analysisResultActions");

export const loadAnalysisResultActions = (): Promise<AnalysisResultActions> =>
  runLazy("Loading analysis result actions…", () => import("./analysisResultActions"));

export function withAnalysisResultActions(run: (actions: AnalysisResultActions) => void): void {
  void loadAnalysisResultActions().then(run, onLoadFailure);
}
