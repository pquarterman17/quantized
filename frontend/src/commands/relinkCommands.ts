// Relink Sources — command palette entry (P1.7 box 3). Published into the
// shared command registry (store/commands.ts's `useCommands`), mirroring
// commands/recentProjectsCommands.ts's own registry-publish pattern rather
// than a File-menu row: relink targets a filesystem folder, not a single
// dataset in the Library tree, and (per that module's header comment) the
// registry — not a static curated list — is the right chokepoint for
// anything that isn't threading through useApp.ts's pinned store.
//
// Deliberately NOT added to the File menu (commands/fileCommands.ts): that
// file's own e2e-locator cross-check (fileCommands.test.ts) exists for
// commands surfaced as literal MenuBar rows, which this isn't.

import { useEffect } from "react";

import { onLoadFailure, runLazy } from "../lib/runLazy";
import { useCommands, type Action } from "../store/commands";

// The relink store loads on the click (bundle headroom slice 14): the panel
// it opens is a lazy chunk that imports the same store, so the gesture
// already waited on a fetch.
const openRelinkPanel = (): void =>
  void runLazy("Loading relink…", () => import("../store/relink")).then(
    (m) => m.useRelink.getState().openPanel(),
    onLoadFailure,
  );

export function useRelinkCommands(): void {
  useEffect(() => {
    const actions: Action[] = [
      {
        id: "relink-sources",
        group: "File",
        section: "Project",
        label: "Relink sources…",
        description:
          "Point datasets at a moved folder — dry-run preview before committing (P1.7).",
        keywords: "relink move folder source reimport portability missing offline",
        run: openRelinkPanel,
      },
    ];
    useCommands.getState().setMenuCommands("relink", actions);
  }, []);
}
