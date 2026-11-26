// Bare-key analysis shortcuts (F, Y, P): launch through the same Analyze command, with the same
// availability check, as the menu, the palette and the Analysis Center, so the shortcut also records
// the recent-analysis entry (commands/analysisCommands.ts `analyze`) and refuses, with the reason, a
// tool the active worksheet cannot feed. Lazy: useGlobalShortcuts imports it on the keypress.

import { runAction } from "./commands";
import { analysisCenterActions } from "./analysisCenterRun";
import { useApp } from "./useApp";

export function launchAnalysis(id: string): void {
  const action = analysisCenterActions().find((a) => a.id === id);
  if (!action) return;
  const off = typeof action.disabled === "function" ? action.disabled() : action.disabled;
  if (off) {
    const why = typeof action.disabledReason === "function" ? action.disabledReason() : action.disabledReason;
    useApp.getState().setStatus(`${action.label.replace(/…$/, "")} unavailable${why ? `: ${why}` : ""}`);
    return;
  }
  runAction(action);
}
