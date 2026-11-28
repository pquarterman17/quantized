// The three Help-menu learning aids (plan item 45): Recent hints, Sample
// gallery and Tip of the day. Lazy-only, like discoveryCommands.ts:
// `buildAppActions` is the one importer, so the descriptions never ship in the
// entry chunk. Each command only flips store/learningDialogs; the dialogs are
// rendered by the lazy LearningHost.

import type { Action } from "../store/commands";
import { useLearningDialogs, type LearningDialog } from "../store/learningDialogs";

function help(id: string, label: string, which: LearningDialog, description: string, keywords: string): Action {
  return { id, group: "Help", label, description, keywords, run: () => useLearningDialogs.getState().show(which) };
}

export function buildLearningCommands(): Action[] {
  return [
    help("recent-hints", "Recent hints…", "hints", "Reread the last status messages and notifications of this session, with their time and any button they offered.", "history log messages toasts notifications status smart hint log review"),
    help("sample-gallery", "Sample gallery…", "gallery", "Open a ready-made sample graph together with its worksheet: error bars, violins, a heat map, a fit with residuals, a ternary diagram or a 3-D surface.", "examples samples learning center templates tutorial demo graphs"),
    help("tip-of-the-day", "Tip of the day…", "tips", "Read a short tip about one feature and the menu path that leads to it; Show at start turns on a tip at every launch.", "tips tricks learn hint startup"),
  ];
}
