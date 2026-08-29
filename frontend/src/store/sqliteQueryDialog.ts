// The SQLite query dialog's open/closed flag and its window-event name.
// A tiny, standalone zustand store -- same shape as
// `store/annotationTextDialog.ts` -- kept OUT of the dialog component file
// deliberately, for two reasons the 2026-08-29 bundle pass measured:
//
// (1) The dialog used to own a `SHOW_SQLITE_QUERY` listener registered in its
//     own `useEffect`, so it had to stay MOUNTED to hear the event at all --
//     which meant an eager static import in `AppOverlays.tsx`. Hoisting the
//     listener here lets `AppOverlays` read the flag and mount the dialog as
//     a `lazyPanel()`, exactly like AnnotationTextDialog/SplitDatasetDialog.
// (2) `commands/dataCommands.ts` (always eager) imported the
//     `SHOW_SQLITE_QUERY` *constant* from the component file. Importing one
//     string from a component module gives that module the same reachability
//     as the command registry, so Rollup bundled the whole dialog eagerly
//     regardless of how `AppOverlays` mounted it. The constant lives here now,
//     so the command registry no longer touches the dialog's render tree.

import { create } from "zustand";

/** Window event that opens the dialog. Dispatched by the Data command and by
 *  any other caller that wants the SQLite importer, without either of them
 *  importing the dialog component. */
export const SHOW_SQLITE_QUERY = "qz:show-sqlite-query";

interface SqliteQueryDialogState {
  open: boolean;
  show: () => void;
  close: () => void;
}

export const useSqliteQueryDialog = create<SqliteQueryDialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

/** Bridge the window event to the store flag. Registered once by
 *  `AppOverlays` (eager) so the event is heard while the dialog chunk is still
 *  unloaded; returns the unsubscribe for `useEffect`. */
export function listenForSqliteQuery(): () => void {
  const show = (): void => useSqliteQueryDialog.getState().show();
  window.addEventListener(SHOW_SQLITE_QUERY, show);
  return () => window.removeEventListener(SHOW_SQLITE_QUERY, show);
}
