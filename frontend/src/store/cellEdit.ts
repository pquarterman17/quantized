// The worksheet cell-edit slice's eager half (MAIN_PLAN #34): one proxy per
// action. The bodies (store/cellEditRun.ts) load on demand (bundle diet slice
// 32, `plans/BUNDLE_HEADROOM.md`): only the lazy worksheet, and the store
// helpers it alone reaches, ever write a cell or insert or delete rows, so
// nothing on first paint needs them.
//
// `components/Stage/worksheet/WorksheetPane.tsx` calls `warmCellEdit()` when
// the worksheet chunk evaluates, so by the first keystroke the bodies are in
// and every action is the same synchronous call it was. A call that still
// beats the FIRST load waits for it and then runs, in call order (store/
// lazyActions.ts). A chunk that will not load says so in the status line and
// a danger toast; after that every cold call is refused (nothing is changed,
// nothing queues) until a background reload lands.
import { toast } from "./toasts";
import type { CellEditSlice } from "./cellEditRun";
import { lazyActions } from "./lazyActions";
import type { AppState } from "./useApp";

export type { CellEditSlice } from "./cellEditRun";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

let loader: ReturnType<typeof lazyActions<CellEditSlice, keyof CellEditSlice>> | null = null;

/** Start loading the cell-edit bodies (a no-op once loaded). */
export const warmCellEdit = (): Promise<void> => loader?.warm() ?? Promise.resolve();

/** Test-only: forget the loaded bodies so a spec can exercise the cold path. */
export const resetCellEditForTests = (): void => loader?.resetForTests();

export function createCellEditSlice(set: SliceSet, get: SliceGet): CellEditSlice {
  loader = lazyActions<CellEditSlice, keyof CellEditSlice>(
    ["setCellValue", "setCellBlock", "insertRows", "deleteRows", "setCategoricalCell"],
    () => import("./cellEditRun").then((m) => m.createCellEditSlice(set, get)),
    (_e, kind) => {
      // At worksheet open no edit has been attempted, so it claims nothing about edits.
      const msg =
        kind === "warm"
          ? "Worksheet editing failed to load. Reload to try again."
          : "Worksheet editing failed to load; nothing was changed. Reload to try again.";
      get().setStatus(msg);
      toast(msg, "danger");
    },
  );
  return loader.actions;
}
