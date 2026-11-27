// The eager half of the figure lifecycle's on-demand actions (bundle diet
// slice 36): one proxy per action whose body (store/figureLifecycleRun.ts)
// loads when a surface that calls it first loads. Every caller is a lazy
// chunk (the Publication Preview view, the Library's figure sections, the
// Figure Page and Graph Builder workshops, the export command, the window
// menu), and each starts the load before it can run: a chunk that reads an
// action's result on its first call awaits `warmFigureLifecycle()` at the top
// level, the others rely on the mount of the surface that owns them. A call
// that still beats the load waits for it and runs, in call order; a chunk that
// will not load says so in the status line and a danger toast, and later cold
// calls are refused (store/lazyActions.ts).
import { lazyActions } from "./lazyActions";
import type { FigureLifecycleRun } from "./figureLifecycleRun";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

const KEYS = [
  "beginFigurePublicationEdit",
  "beginDetachedFigurePublicationEdit",
  "beginFigurePublicationEditForFigure",
  "applyFigurePublicationEdit",
  "promoteLegacyFigureDoc",
  "saveFigureAs",
  "openEditableFigure",
  "renameEditableFigure",
  "duplicateEditableFigure",
  "deleteEditableFigure",
] as const satisfies readonly (keyof FigureLifecycleRun)[];

let loader: ReturnType<typeof lazyActions<FigureLifecycleRun, (typeof KEYS)[number]>> | null = null;

/** Start loading the figure actions (a no-op once loaded). */
export const warmFigureLifecycle = (): Promise<void> => loader?.warm() ?? Promise.resolve();

/** Test-only: forget the loaded bodies so a spec can exercise the cold path. */
export const resetFigureLifecycleForTests = (): void => loader?.resetForTests();

export function figureLifecycleProxy(set: SliceSet, get: SliceGet): FigureLifecycleRun {
  loader = lazyActions<FigureLifecycleRun, (typeof KEYS)[number]>(
    KEYS,
    () => import("./figureLifecycleRun").then((m) => m.createFigureLifecycleRun(set, get)),
    (_e, kind) => {
      const msg =
        kind === "warm"
          ? "Figure tools failed to load. Reload to try again."
          : "Figure tools failed to load; nothing was changed. Reload to try again.";
      get().setStatus(msg);
      toast(msg, "danger");
    },
  );
  return loader.actions as FigureLifecycleRun;
}
