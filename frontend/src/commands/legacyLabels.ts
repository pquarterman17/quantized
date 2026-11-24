// Findability after a menu relabel (UX audit 10, P1-3 / P1-8): a command whose
// label changed stays reachable in the palette under its OLD name, as a
// synonym. The old text is appended to the command's `keywords`, which the
// palette ranks as a synonym match (lib/paletteRank.ts). Nothing is removed.
//
// Applied in `mergeCommands` (store/commands.ts), the one place the menubar, the
// palette and Help build their list from: commandDocs.ts owns the core commands'
// keywords, so the synonym cannot live on the command itself. Commands published by hooks (windows, history,
// relink, project lock) carry their old names in their own `keywords`.

import type { Action } from "../store/commands";

/** command id -> the label(s) it used to have (and old spellings people still type). */
export const LEGACY_LABELS: Readonly<Record<string, string>> = {
  "pack-project": "Pack Project",
  "save-workspace": "Save workspace (.dwk) save as",
  "recalc-mode": "Recalc mode None cycle auto manual",
  "set-column-values": "Set Column Values",
  "y-axis-settings": "Y Axis Settings",
  "layer-contents": "Layer Contents",
  "plot-recipe-manager": "Recipe Library",
  "graph-template-save": "Save Graph Template",
  "graph-template-apply": "Apply Graph Template",
  "graph-template-default": "Set as Default for New Graphs",
  "copy-format": "Copy Format",
  "paste-format": "Paste Format",
  "graph-template-apply-many": "Apply Graph Template to Graphs",
  "paste-format-many": "Paste Format to Graphs",
  "color-gradient": "Colour gradient colour",
  "signal-processing": "Signal Processing",
  "theme": "Toggle theme",
  "toggle-excluded-rows": "Toggle greyed excluded rows",
  "left": "Toggle library panel",
  "right": "Toggle inspector panel",
  "preferences": "Settings Preferences",
  "quick-convert": "Quick Convert",
  // Menu labels shortened to 40 characters or fewer (UX menus audit N5): the old text stays a search term.
  "export-page": "Export page spatial true page coords",
  "export-worksheet": "Export worksheet CSV TSV Excel",
  "column-switcher": "Column switcher flip through channels",
  "map-ops": "Map operations crop flip rotate level map math levelling leveling",
  magtools: "Magnetometry background units Curie-Weiss",
  reflview: "Reflectometry view data model SLD",
  digitizer: "Graph digitizer trace a curve from an image",
  distribution: "Distribution histogram normality of a column",
  multivar: "Multivariate correlation SPLOM PCA",
  "variability-chart": "Variability chart nested ANOVA variance components",
  "stats-chooser": "Test chooser which stats test run it",
  "stats-tests": "Statistical tests normality paired Dunnett regression power control charts capability life data",
  "fit-y-by-x": "Fit Y by X oneway bivariate contingency",
  "fit-model": "Fit model least squares effects LS means",
  profiler: "Profiler prediction contour desirability",
  doe: "Design of experiments factorial screening response surface",
  "graph-builder": "Graph Builder drag columns into X Y Group wells",
  tabulate: "Tabulate group summary stats by column",
  "row-statistics": "Row statistics mean SD min max sum N across columns",
  "frequency-count": "Frequency count bin a column into a table",
  pipeline: "Pipeline edit re-run recorded steps",
  "recalc-now": "Recalculate now run stale corrections fits",
  "data-filter": "Data filter live per-column row filter",
  yLog: "Cycle Y axis scale linear log reciprocal",
  xLog: "Cycle X axis scale linear log reciprocal",
  statMode: "Toggle statistics view box violin Q-Q histogram",
  "dataset-math": "Dataset math combine two datasets",
  calculators: "DiraCulator materials calculators",
  "axis-dialog": "Axis… axis settings",
};

export function withLegacyLabels(actions: Action[]): Action[] {
  return actions.map((a) => {
    const old = LEGACY_LABELS[a.id];
    return old ? { ...a, keywords: a.keywords ? `${a.keywords} ${old}` : old } : a;
  });
}
