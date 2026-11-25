// Help copy for the commands that hooks publish into the registry
// (store/commands.ts `setMenuCommands`: Window, Edit > Undo history, project
// lock, relink, workbook paste): each one's description and extra ⌘K search
// keywords, keyed by command id.
//
// Bundle diet (plans/BUNDLE_HEADROOM.md): the hooks run at startup, but only
// the surfaces that show or search this copy read it (the menus' item tooltips,
// the ⌘K palette and Help), and none of those renders at first paint. As fields
// of the published commands the strings shipped in the entry chunk; they live
// here instead and each lazy surface merges them in (`withHookDocs`). The
// published commands carry no description or keywords of their own.
//
// The old menu names stay findable here as synonyms (commands/legacyLabels.ts
// is the table for the core commands).

import { withLegacyLabels } from "./legacyLabels";
import { mergeCommands, type Action } from "../store/commands";

interface HookDocs {
  description?: string;
  keywords?: string;
}

export const HOOK_COMMAND_DOCS: Readonly<Record<string, HookDocs>> = {
  "figure-save": {
    description: "Save the focused plot window as a reopenable editable figure document.",
    keywords: "figure document save plot window editable Save Editable Figure",
  },
  "figure-save-as": {
    description: "Save the focused plot window as a new named editable figure document.",
    keywords: "figure document save as copy plot window editable Save Editable Figure As",
  },
  "figure-save-recipe": {
    description: "Save the focused plot window's mapping + visual style as a reusable plot recipe.",
    keywords: "plot recipe save template reuse reapply Save as Plot Recipe",
  },
  "window-duplicate": { keywords: "Duplicate Window" },
  "window-snapshot": { keywords: "Snapshot to New Window" },
  "window-bg-cycle": { keywords: "Window Background" },
  "window-link-cycle": { keywords: "Link Window Group" },
  "window-pin": { keywords: "Pin Window toggle" },
  "window-focus-next": { keywords: "Focus Next Window" },
  "window-focus-prev": { keywords: "Focus Previous Window" },
  "history-list": {
    description: "List the last 20 edits and jump back to any of them; Redo returns.",
    keywords: "history undo history list steps timeline jump back revert earlier states",
  },
  "take-over-editing": {
    description: "Take over a project whose other editing instance is unresponsive (stale lock).",
    keywords: "lock takeover stale unresponsive concurrent single-writer Take Over Editing",
  },
  "open-as-copy": {
    description: "Keep working without the original project's lock — saves land at a new location.",
    keywords: "copy read-only lock duplicate open as Open as Copy",
  },
  "relink-sources": {
    description: "Point datasets at a moved folder — dry-run preview before committing.",
    keywords: "relink move folder source reimport portability missing offline",
  },
  "paste-workbook": {
    description: "Paste a workbook copied from this or another Quantized instance, at the Library root.",
    keywords: "paste workbook copy clipboard transfer cross-instance",
  },
};

/** `actions` with the hook commands' description and keywords merged in. A
 *  command outside the table, or one that carries its own copy, is left alone. */
export function withHookDocs<T extends Action>(actions: readonly T[]): T[] {
  return actions.map((a) => {
    const docs = Object.hasOwn(HOOK_COMMAND_DOCS, a.id) ? HOOK_COMMAND_DOCS[a.id] : undefined;
    if (!docs) return a;
    return {
      ...a,
      ...(a.description === undefined && docs.description !== undefined ? { description: docs.description } : {}),
      ...(a.keywords === undefined && docs.keywords !== undefined ? { keywords: docs.keywords } : {}),
    };
  });
}

/** What the ⌘K palette and Help search: the merged registry with the hook
 *  commands' docs and the relabelled commands' old names (legacyLabels.ts)
 *  merged in. `mergeCommands` itself stays the cheap, eager dedupe. */
export function mergeSearchable(curated: Action[], menu: Action[]): Action[] {
  return withLegacyLabels(withHookDocs(mergeCommands(curated, menu)));
}
