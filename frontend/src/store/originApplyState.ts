// View-state resets every Origin-figure apply branch spreads, moved verbatim
// out of `store/originApplyRun.ts` so the spatial-panel half
// (`store/originApplyPanels.ts`) shares them. Lazy with both importers.

// Origin figures apply boxed + gridless (item 4; grid undecodable) — Origin's clean look, ticks still draw, user re-enables.
// Origin figures apply gridless + boxed + a clean read-only legend (decode
// #52); every apply branch spreads this, so `legendStatic` costs zero lines.
export const ORIGIN_FIGURE_AXIS = { showAxisBox: true, showGrid: false, legendStatic: true };

// Applying a recovered graph is a whole-view command, not a dataset switch.
// `setActive()` deliberately preserves presentation choices when the target
// dataset is already active, but that is dangerous here: a prior polar/stat/
// stacked view can otherwise keep rendering instead of the recovered XY
// graph, and stale Y2 membership can route its only curve to an old axis
// range.  The corpus harness used to hide this real-UI bug by clearing these
// fields before every screenshot.  Keep the reset beside the apply body so
// every branch gets the same clean mode transition.
export const ORIGIN_FIGURE_MODE_RESET = {
  stackMode: false,
  insetMode: false,
  exchangeXY: false, // a recovered graph is drawn as saved, never beside a stale exchange
  polarMode: false,
  statMode: false,
  composition: null,
  facetKey: null,
  groupKey: null,
  waterfall: 0,
  waterfallDx: 0,
  seriesOrder: null,
  seriesRamp: null, // gap audit 4 review L1: a recovered graph never inherits the previous one's gradient
};

export const ORIGIN_FIGURE_Y2_RESET = {
  y2Keys: null,
  y2Lim: null,
  y2Scale: null,
  y2Step: null,
  y2AxisLabel: "",
  yAxes: [],
  yAxisOf: {},
};
