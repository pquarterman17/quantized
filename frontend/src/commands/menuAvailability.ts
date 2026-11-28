// Menu enablement (UX audit 10, P1-1): a command with nothing to act on is
// DISABLED with a reason in its tooltip, the way every Analyze item already is,
// instead of enabled and then either doing nothing or posting a red toast.
//
// One table keyed by command id, applied once over the built registry
// (`withMenuAvailability`, appCommands.ts). Keeping it out of the ~25 command
// modules means the rule set is reviewable in one place and the modules that
// sit at their line ceilings do not grow. A command that already declares its
// own `disabled` keeps it: the two combine, and its own reason wins.
//
// Lazy-only, like commands/analysisCommands.ts: appCommands.ts is the one
// importer. Menus and the palette evaluate `disabled` when they open, never at
// build time, so the predicates read live state.

import { AUX_VIEW_HAS_OWN_EXPORT, AUX_VIEW_IS_NOT_XY, auxFigureViewShown } from "../lib/auxFigureView";
import type { StoreGet } from "../lib/exportActive";
import { NEEDS_DATASET } from "../lib/menuReasons";
import type { Action } from "../store/commands";

export { NEEDS_DATASET };
const NEEDS_TWO_SELECTED = "Select 2 or more datasets in the Library first";
const NEEDS_TWO_DATASETS = "Needs 2 or more datasets";

interface Rule {
  off: (s: StoreGet) => boolean;
  why: string | ((s: StoreGet) => string);
}

const noActive: Rule = { off: (s) => !s().activeId, why: NEEDS_DATASET };
const fewSelected: Rule = { off: (s) => s().selectedIds.length < 2, why: NEEDS_TWO_SELECTED };
const fewDatasets: Rule = { off: (s) => s().datasets.length < 2, why: NEEDS_TWO_DATASETS };
// Same condition, same words as "noActive" (UX menus audit N2): one phrase for "nothing to act on".
const noDatasets: Rule = { off: (s) => s().datasets.length === 0, why: NEEDS_DATASET };

/** Ids that act on the active dataset or its plot. */
const NEEDS_ACTIVE: readonly string[] = [
  // Data
  "duplicate", "reimport", "split", "transpose", "stack-columns", "unstack-columns", "remove-duplicate-rows",
  "fill-missing-values", "standardize-columns", "sort-worksheet", "add-column", "tabulate", "row-statistics", "frequency-count", "data-filter",
  // File: export and figure document
  "export-csv", "export-hdf5", "export-origin", "send-to-origin", "export-worksheet", "export-page", "figure-save",
  "figure-save-as", "figure-save-recipe",
  // Plot: axes, display, layout, build and export
  "autoscale", "axis-dialog", "xLog", "yLog", "xTickFormat", "yTickFormat", "y-axis-settings", "grid", "legend",
  "stacked", "panel-fit", "page-setup", "statMode", "facet-by-column", "break-x-axis", "break-y-axis",
  "plot-in-new-window", "plot-setup", "layer-contents", "add-curve-from", "color-gradient", "legend-format", "link-x-axis",
  "link-y-axis", "plot-type", "graph-template-save", "graph-template-apply", "graph-template-default",
  "graph-template-apply-many", "copy-format", "paste-format", "paste-format-many", "send-figure-to-report",
  "waterfall", "waterfall-export", "export-figure", "export-figure-quick", "figure-builder", "figure-page",
  "graph-builder", "ternary-figure", "field-figure", "contour-scattered",
  "plot-parallel", "plot-hexbin", "plot-kde2d", "plot-pareto", "plot-blandAltman",
  // Insert: a drawing tool or layer needs a plot to draw on
  "insert-arrow", "insert-line", "insert-rect", "insert-ellipse", "insert-textbox", "insert-slope", "insert-distance", "insert-angle", "insert-scalebar", "insert-inset", "insert-image",
  "insert-table",
  // Edit
  "rename-dataset",
  // Analyze: the direct SPC / life launchers open a test that reads columns
  "quality-control-chart", "quality-capability", "quality-life-distribution",
];

const RULES: Record<string, Rule> = {
  ...Object.fromEntries(NEEDS_ACTIVE.map((id) => [id, noActive])),
  "exchange-xy": noActive,
  "inset-mode": noActive,
  "recalc-now": noDatasets,
  merge: fewSelected,
  "plot-selected-together": fewSelected,
  "panel-row": fewSelected,
  "panel-column": fewSelected,
  "panel-grid": fewSelected,
  "panel-overlay": fewSelected,
  "dataset-math": fewDatasets,
  "join-by-key": fewDatasets,
  "export-consolidated": noDatasets,
  "export-origin-project": noDatasets,
  // The format shortcuts (File > Export PDF / SVG / PNG) take the same dataset gate as Export figure….
  "export-pdf": noActive,
  "export-svg": noActive,
  "export-png": noActive,
  "scale-x-log": noActive,
  "scale-x-linear": noActive,
  "scale-y-log": noActive,
  "scale-y-linear": noActive,
  "remove-all": { off: (s) => s().datasets.length === 0, why: "Nothing to remove" },
  "view-back": { off: (s) => s().viewHistory.length === 0, why: "No earlier view to go back to" },
  "view-forward": { off: (s) => s().viewFuture.length === 0, why: "No later view to go forward to" },
};

/** UX menus audit M1: while a Plots2 or polar-map view is the stage, these act on the HIDDEN XY
 *  plot, so they are disabled with a reason. First, the exports: each of those views has its own
 *  Export (the button above its preview), and the File > Export figure entries would export the
 *  wrong figure. Plot type… stays enabled: it is the way back. */
const AUX_OWN_EXPORT: readonly string[] = [
  "export-figure", "export-figure-quick", "export-pdf", "export-svg", "export-png", "copy-figure", "figure-page",
  "figure-builder", "export-page", "page-setup", "send-figure-to-report",
];
/** Second, everything that draws on or restyles the XY canvas: axes, legend, curves, layout, Insert tools. */
const AUX_XY_ONLY: readonly string[] = [
  "autoscale", "axis-dialog", "y-axis-settings", "xLog", "yLog", "xTickFormat", "yTickFormat", "exchange-xy", "link-x-axis",
  "link-y-axis", "scale-x-log", "scale-x-linear", "scale-y-log", "scale-y-linear", "view-back", "view-forward", "grid",
  "legend", "legend-format", "statMode", "inset-mode", "color-gradient", "layer-contents", "add-curve-from", "copy-format",
  "paste-format", "paste-format-many", "graph-template-save", "graph-template-apply", "graph-template-default",
  "graph-template-apply-many", "stacked", "panel-fit", "facet-by-column", "break-x-axis", "break-y-axis", "waterfall",
  "waterfall-export", "error-bars", "insert-arrow", "insert-line", "insert-rect", "insert-ellipse", "insert-textbox",
  "insert-slope", "insert-distance", "insert-angle", "insert-scalebar",
  "insert-inset", "insert-image", "insert-table",
];
const AUX_REASON: ReadonlyMap<string, string> = new Map([
  ...AUX_OWN_EXPORT.map((id): [string, string] => [id, AUX_VIEW_HAS_OWN_EXPORT]),
  ...AUX_XY_ONLY.map((id): [string, string] => [id, AUX_VIEW_IS_NOT_XY]),
]);

const text = (why: Rule["why"], s: StoreGet): string => (typeof why === "function" ? why(s) : why);
const own = <T,>(v: T | (() => T) | undefined): T | undefined => (typeof v === "function" ? (v as () => T)() : v);

/** `actions` with the nothing-to-act-on rules above merged into each command's
 *  `disabled` / `disabledReason`. */
export function withMenuAvailability(actions: Action[], s: StoreGet): Action[] {
  return actions.map((action) => {
    const rule = RULES[action.id];
    const aux = AUX_REASON.get(action.id);
    if (!rule && !aux) return action;
    // Order of reasons: the command's own, then "this view is not XY" (it is on screen, so the
    // user can see why), then the nothing-to-act-on rule.
    const auxOff = () => aux !== undefined && auxFigureViewShown(s());
    return {
      ...action,
      disabled: () => own(action.disabled) === true || auxOff() || (rule?.off(s) ?? false),
      disabledReason: () =>
        own(action.disabled) === true ? own(action.disabledReason) : auxOff() ? aux : rule ? text(rule.why, s) : undefined,
    };
  });
}

/** The rule ids, for the test that every one names a real command. */
export const AVAILABILITY_RULE_IDS: readonly string[] = [...Object.keys(RULES), ...AUX_REASON.keys()];
