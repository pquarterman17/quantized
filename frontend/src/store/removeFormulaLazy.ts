// The eager half of the computed-column removal action (bundle diet slice 35):
// one proxy for `removeFormula`. Its body (store/removeFormulaRun.ts) loads on
// demand because only the lazy worksheet removes a computed column, and the
// body is what pulls the formula-letter rewrite, the channel remap and the
// figure/window/graph column-shift holders into the entry chunk.
//
// `components/Stage/worksheet/WorksheetPane.tsx` starts the load when the
// worksheet chunk evaluates, so by the first click the body is in and the
// action is the same synchronous call it was. A call that beats the first load
// waits for it and runs; a chunk that will not load says so in the status line
// and a danger toast, and later cold calls are refused (store/lazyActions.ts).
import { lazyActions } from "./lazyActions";
import type { ComputedColumnsSlice } from "./computedColumns";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;
type RemoveFormulaSlice = Pick<ComputedColumnsSlice, "removeFormula">;

let loader: ReturnType<typeof lazyActions<RemoveFormulaSlice, "removeFormula">> | null = null;

/** Start loading the removal body (a no-op once loaded). */
export const warmRemoveFormula = (): Promise<void> => loader?.warm() ?? Promise.resolve();

/** Test-only: forget the loaded body so a spec can exercise the cold path. */
export const resetRemoveFormulaForTests = (): void => loader?.resetForTests();

export function createRemoveFormulaProxy(set: SliceSet, get: SliceGet): RemoveFormulaSlice {
  loader = lazyActions<RemoveFormulaSlice, "removeFormula">(
    ["removeFormula"],
    () => import("./removeFormulaRun").then((m) => m.createRemoveFormulaSlice(set, get)),
    (_e, kind) => {
      const msg =
        kind === "warm"
          ? "Removing a computed column failed to load. Reload to try again."
          : "Removing a computed column failed to load; nothing was changed. Reload to try again.";
      get().setStatus(msg);
      toast(msg, "danger");
    },
  );
  return loader.actions;
}
