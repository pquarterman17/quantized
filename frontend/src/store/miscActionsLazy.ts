// The eager half of seven on-demand slice actions (bundle diet slice 37): one
// proxy per action whose body (store/miscActionsRun.ts) loads when a surface
// that calls it first loads. Every caller is a lazy chunk: the derived
// worksheet banner and its context action (Freeze Copy), the Separate and
// Combine dialogs and the Import-as-sheets command, the Library's saved-figure
// section, the Quick Figure builder, Quick Plot With and the recipe library.
// A chunk that reads an action's result on its first call imports
// `store/miscActionsReady.ts` for its effect, so the bodies are in before it
// runs; any other call that beats the load waits for it and runs, in call
// order. A chunk that will not load says so in the status line and a danger
// toast, and later cold calls are refused (store/lazyActions.ts).
import { lazyActions } from "./lazyActions";
import type { MiscActionsRun } from "./miscActionsRun";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

const KEYS = [
  "freezeCopy",
  "commitSeparateWorksheets",
  "combineWorkbooks",
  "openFigureDocInWindow",
  "saveQuickPlotTemplate",
  "duplicateQuickPlotTemplate",
  "applyQuickPlotTemplate",
] as const satisfies readonly (keyof MiscActionsRun)[];

let loader: ReturnType<typeof lazyActions<MiscActionsRun, (typeof KEYS)[number]>> | null = null;

/** Start loading the bodies (a no-op once loaded). */
export const warmMiscActions = (): Promise<void> => loader?.warm() ?? Promise.resolve();

/** Test-only: forget the loaded bodies so a spec can exercise the cold path. */
export const resetMiscActionsForTests = (): void => loader?.resetForTests();

/** The proxies, created once and shared by the slices that spread them. */
export function miscActions(set: SliceSet, get: SliceGet): MiscActionsRun {
  loader ??= lazyActions<MiscActionsRun, (typeof KEYS)[number]>(
    KEYS,
    () => import("./miscActionsRun").then((m) => m.createMiscActionsRun(set, get)),
    (_e, kind) => {
      const msg =
        kind === "warm"
          ? "Worksheet and figure tools failed to load. Reload to try again."
          : "Worksheet and figure tools failed to load; nothing was changed. Reload to try again.";
      get().setStatus(msg);
      toast(msg, "danger");
    },
  );
  return loader.actions as MiscActionsRun;
}
