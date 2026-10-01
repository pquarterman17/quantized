// The Stat Stage's persisted display options (PRIMARY_SOFTWARE_AUDIT_PLAN
// P2.6 box 2): hide empty category levels, and the per-group n annotation;
// box 4's leftover: whether the per-group summary table is open; and the
// stage's picks (plot type, columns, Q-Q/histogram/bar options).
//
// The FIELDS are ordinary PlotView state (`lib/plotview.ts`: declared on
// `AppState`, defaulted in `defaultPlotView`, sanitized on load), so they ride
// every window snapshot, undo entry and `.dwk` exactly like `statMode`. Only
// the two WRITERS live here, outside `store/plotViewSettings.ts`, and that is a
// bundle decision: the slice is in the eager graph, and the only caller is the
// lazily loaded Stat Stage, so writers defined here load with it instead of
// adding to first paint (the `store/levelOrder.ts` shape: plain functions over
// `useApp.getState()` with one `recordHistory` per edit).

import type { StatMarks, StatMarksMode, StatPicks } from "../lib/plotviewSanitize";
import { useApp } from "./useApp";

export function setStatHideEmptyLevels(statHideEmptyLevels: boolean): void {
  useApp.getState().recordHistory("toggle empty levels");
  useApp.setState({ statHideEmptyLevels });
}

export function setStatShowGroupN(statShowGroupN: boolean): void {
  useApp.getState().recordHistory("toggle group n");
  useApp.setState({ statShowGroupN });
}

/** P2.6 box 4 leftover: the summary table's visibility persists with the plot
 *  (it was session-local `useState` in StatStage), one undo entry per toggle. */
export function setStatShowSummary(statShowSummary: boolean): void {
  useApp.getState().recordHistory("toggle summary table");
  useApp.setState({ statShowSummary });
}

/** P2.6 box 1: merge `patch` into the persisted categorical-plot marks —
 *  `PlotView.statMarks[mode]` ONLY (review finding 6: each mode keeps its
 *  own bucket, so a choice made in one mode — say strip's `points: "none"`
 *  — can never read as another mode's default — say box's fliers going
 *  dark too, because the two used to share one flat object). One undo
 *  entry per edit. */
export function setStatMarks(mode: StatMarksMode, patch: StatMarks, label = "change plot marks"): void {
  const st = useApp.getState();
  st.recordHistory(label);
  useApp.setState({ statMarks: { ...st.statMarks, [mode]: { ...st.statMarks[mode], ...patch } } });
}

/** The Stat Stage's picks — plot type, columns, Q-Q/histogram/bar options —
 *  persisted on `PlotView.statPicks` (they were React state, lost on save +
 *  reopen). `update` maps the current picks to the next (the same object =
 *  no change); one undo entry per edit. */
export function setStatPicks(update: (picks: StatPicks) => StatPicks, label = "change statistics plot"): void {
  const st = useApp.getState();
  const statPicks = update(st.statPicks);
  if (statPicks === st.statPicks) return; // unchanged: no undo entry
  st.recordHistory(label);
  useApp.setState({ statPicks });
}
