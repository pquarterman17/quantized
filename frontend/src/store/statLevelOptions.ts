// The Stat Stage's two persisted display options (PRIMARY_SOFTWARE_AUDIT_PLAN
// P2.6 box 2): hide empty category levels, and the per-group n annotation.
//
// The FIELDS are ordinary PlotView state (`lib/plotview.ts`: declared on
// `AppState`, defaulted in `defaultPlotView`, sanitized on load), so they ride
// every window snapshot, undo entry and `.dwk` exactly like `statMode`. Only
// the two WRITERS live here, outside `store/plotViewSettings.ts`, and that is a
// bundle decision: the slice is in the eager graph, and the only caller is the
// lazily loaded Stat Stage, so writers defined here load with it instead of
// adding to first paint (the `store/levelOrder.ts` shape: plain functions over
// `useApp.getState()` with one `recordHistory` per edit).

import { useApp } from "./useApp";

export function setStatHideEmptyLevels(statHideEmptyLevels: boolean): void {
  useApp.getState().recordHistory("toggle empty levels");
  useApp.setState({ statHideEmptyLevels });
}

export function setStatShowGroupN(statShowGroupN: boolean): void {
  useApp.getState().recordHistory("toggle group n");
  useApp.setState({ statShowGroupN });
}
