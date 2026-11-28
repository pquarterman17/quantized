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
  "plot-setup": "Plot Setup",
  "plot-recipe-manager": "Recipe Library",
  "graph-template-save": "Save Graph Template",
  "graph-template-apply": "Apply Graph Template",
  "graph-template-default": "Set as Default for New Graphs",
  "copy-format": "Copy Format",
  "paste-format": "Paste Format",
  "paste-format-parts": "Paste Format (Choose Parts)",
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
};

export function withLegacyLabels(actions: Action[]): Action[] {
  return actions.map((a) => {
    const old = LEGACY_LABELS[a.id];
    return old ? { ...a, keywords: a.keywords ? `${a.keywords} ${old}` : old } : a;
  });
}
