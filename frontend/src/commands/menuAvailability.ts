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

import type { StoreGet } from "../lib/exportActive";
import type { Action } from "../store/commands";

export const NEEDS_DATASET = "Import or select a dataset first";
const NEEDS_TWO_SELECTED = "Select 2 or more datasets in the Library first";
const NEEDS_TWO_DATASETS = "Needs 2 or more datasets";

interface Rule {
  off: (s: StoreGet) => boolean;
  why: string | ((s: StoreGet) => string);
}

const noActive: Rule = { off: (s) => !s().activeId, why: NEEDS_DATASET };
const fewSelected: Rule = { off: (s) => s().selectedIds.length < 2, why: NEEDS_TWO_SELECTED };
const fewDatasets: Rule = { off: (s) => s().datasets.length < 2, why: NEEDS_TWO_DATASETS };
const noDatasets: Rule = { off: (s) => s().datasets.length === 0, why: "No datasets yet: import one first" };

/** Ids that act on the active dataset or its plot. */
const NEEDS_ACTIVE: readonly string[] = [
  // Data
  "duplicate", "reimport", "split", "transpose", "stack-columns", "unstack-columns", "remove-duplicate-rows",
  "fill-missing-values", "standardize-columns", "tabulate", "row-statistics", "frequency-count", "data-filter",
  // File: export and figure document
  "export-csv", "export-hdf5", "export-origin", "send-to-origin", "export-worksheet", "export-page", "figure-save",
  "figure-save-as", "figure-save-recipe",
  // Plot: axes, display, layout, build and export
  "autoscale", "axis-dialog", "xLog", "yLog", "xTickFormat", "yTickFormat", "y-axis-settings", "grid", "legend",
  "stacked", "panel-fit", "page-setup", "statMode", "facet-by-column", "break-x-axis", "break-y-axis",
  "plot-in-new-window", "layer-contents", "add-curve-from", "color-gradient", "legend-format", "link-x-axis",
  "link-y-axis", "plot-type", "graph-template-save", "graph-template-apply", "graph-template-default",
  "graph-template-apply-many", "copy-format", "paste-format", "paste-format-many", "send-figure-to-report",
  "waterfall", "waterfall-export", "export-figure", "export-figure-quick", "figure-builder", "figure-page",
  "graph-builder", "ternary-figure", "field-figure", "contour-scattered",
  // Insert: a drawing tool or layer needs a plot to draw on
  "insert-arrow", "insert-line", "insert-rect", "insert-ellipse", "insert-textbox", "insert-inset", "insert-image",
  "insert-table",
  // Edit
  "rename-dataset",
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
  "remove-all": { off: (s) => s().datasets.length === 0, why: "Nothing to remove" },
  "view-back": { off: (s) => s().viewHistory.length === 0, why: "No earlier view to go back to" },
  "view-forward": { off: (s) => s().viewFuture.length === 0, why: "No later view to go forward to" },
};

const text = (why: Rule["why"], s: StoreGet): string => (typeof why === "function" ? why(s) : why);
const own = <T,>(v: T | (() => T) | undefined): T | undefined => (typeof v === "function" ? (v as () => T)() : v);

/** `actions` with the nothing-to-act-on rules above merged into each command's
 *  `disabled` / `disabledReason`. */
export function withMenuAvailability(actions: Action[], s: StoreGet): Action[] {
  return actions.map((action) => {
    const rule = RULES[action.id];
    if (!rule) return action;
    return {
      ...action,
      disabled: () => own(action.disabled) === true || rule.off(s),
      disabledReason: () => (own(action.disabled) === true ? own(action.disabledReason) : text(rule.why, s)),
    };
  });
}

/** The rule ids, for the test that every one names a real command. */
export const AVAILABILITY_RULE_IDS: readonly string[] = Object.keys(RULES);
