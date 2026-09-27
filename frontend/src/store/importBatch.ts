// The double-import guard's state, split out of `store/importDatasets.ts`
// (bundle headroom slice 10, `plans/BUNDLE_HEADROOM.md`) so it can stay eager
// while the import slice itself loads on first use.
//
// P3.4 slice 1, 2026-07-26 audit gap #1: the single source of truth for "is a
// batch import running right now". A standalone store for the same reason
// pendingOps/toasts/commands are — session-only UI state that must never touch
// useApp.ts's size ratchet.
//
// `runImport` (store/importDatasets.ts) is the primary writer
// (importFiles/importPaths both route through it). `commands/fileCommands.ts`
// reads it for its pre-flight check (so "Import…" does not even pop a file
// dialog while a batch runs) and sets/clears it around "import-append", whose
// implementation (`importFilesAppended`) lives in useApp.ts. Every OTHER import
// entry point (⌘O, the command palette, the Library toolbar button, drag-drop,
// the Recent-files list) calls `importFiles`/`importPaths` directly or through
// `lib/importEntry.ts`'s `chooseAndImport`, so guarding those two actions
// covers all of them from one chokepoint.
//
// Synchronous readers are why this cannot ride the lazy chunk: the pre-flight
// check must answer before any `import()` could settle.

import { create } from "zustand";

interface ImportBatchState {
  running: boolean;
}
export const useImportBatch = create<ImportBatchState>(() => ({ running: false }));

/** True while an import batch is in flight. */
export function isImportRunning(): boolean {
  return useImportBatch.getState().running;
}

/** Shared by `runImport`'s chokepoint and commands/fileCommands.ts's
 *  pre-flight guard — imported, not retyped, so the two guard messages can't
 *  drift apart. */
export const ALREADY_RUNNING_MSG = "an import is already running — cancel it first";
