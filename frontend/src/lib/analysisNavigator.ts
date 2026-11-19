// Pure helpers behind the Analyze menu's navigator rows ("Recent analyses",
// "Open results (N)"). The menu model (components/Shell/appMenuModel.ts) owns
// the rendering; keeping the selection rules here makes them unit-testable.

import type { AnalysisResult } from "./analysisResult";
import type { Action } from "../store/commands";

export const RECENT_ANALYSES_LIMIT = 5;

/** The last-run Analyze tools, newest first, resolved against the live command
 *  list (an id that is no longer a command is dropped). `recent` is the
 *  persisted Analysis Center list (store/analysisCenter.ts). The Analysis
 *  Center itself is a navigator, not an analysis, so it never counts. */
export function recentAnalysisActions(actions: readonly Action[], recent: readonly string[]): Action[] {
  const byId = new Map(actions.filter((a) => a.group === "Analyze").map((a) => [a.id, a]));
  const out: Action[] = [];
  for (const id of recent) {
    const action = byId.get(id);
    if (action && id !== "analysis-center") out.push(action);
    if (out.length === RECENT_ANALYSES_LIMIT) break;
  }
  return out;
}

/** Saved results that read from, or wrote to, worksheet `datasetId`. */
export function resultsForDataset(results: readonly AnalysisResult[], datasetId: string | null): AnalysisResult[] {
  if (!datasetId) return [];
  return results.filter(
    (r) => r.sources.some((s) => s.datasetId === datasetId) || r.outputs.some((o) => o.datasetId === datasetId),
  );
}
