// ONE rule for "which dataset does this act on?" (UX audit 10, P0-1). Every
// single-dataset command and every analysis tool's direct launch reads it, so
// the dataset a command acts on is always the one the UI names.
//
// The two pieces of state it reconciles:
//   activeId     the dataset on the FOCUSED plot (what the title bar, status
//                bar and plot show);
//   selectedIds  the Library selection. A Tree single-click highlights a row
//                WITHOUT plotting it (L0.25, owner-confirmed 2026-08-13), so
//                the highlight can name a different dataset than the plot.
//
// THE RULE: a command acts on the dataset you last pointed at.
//   - Nothing selected, or the focused plot's dataset is part of the selection
//     -> the focused plot's dataset.
//   - Otherwise (a Tree click, or a multi-selection that leaves the plot out)
//     -> the first selected dataset, in selection order.
// Focusing a plot window or plotting a dataset resets the selection to that
// dataset (store/windowFocus `_focusHandoff`, `setActive`), so "last pointed
// at" is exactly what these two fields already record.
//
// A tool that analyses a PLOT (curve fit, peaks, hysteresis, baseline) never
// runs on a target that is off screen: opening it shows the target on the
// focused plot first (lib/toolTarget `revealToolInput`), and from then on the
// tool follows the focused plot. A single highlighted row is a highlight, not a
// batch scope: only two or more selected datasets make a Library batch
// (lib/analysisSelection `captureAnalysisSelection`).
//
// Pure: no store, no React (the eager command registry imports it).

export interface TargetState {
  datasets: readonly { id: string }[];
  activeId: string | null;
  selectedIds: readonly string[];
}

/** The Library selection, deduplicated, without deleted datasets, in order. */
export function liveSelection(state: TargetState): string[] {
  const live = new Set(state.datasets.map((dataset) => dataset.id));
  return [...new Set(state.selectedIds)].filter((id) => live.has(id));
}

/** The focused plot's dataset, or null when there is none (or it was deleted). */
export function liveActiveId(state: TargetState): string | null {
  return state.activeId != null && state.datasets.some((dataset) => dataset.id === state.activeId) ? state.activeId : null;
}

/** The dataset a command acts on (see THE RULE above), or null for none. */
export function commandTargetId(state: TargetState): string | null {
  const active = liveActiveId(state);
  const selected = liveSelection(state);
  if (selected.length === 0 || (active != null && selected.includes(active))) return active ?? selected[0] ?? null;
  return selected[0];
}
