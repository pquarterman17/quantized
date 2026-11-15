// Gap audit 6 lane K (B1): a fit curve survives reopening a project.
//
// Opening a .dwk or restoring the autosave starts from cleared overlay
// singletons (store/workspaceHydration). A figure saved since gap audit 5 lane
// C carries its overlays in its document and hydration seeds them back
// (store/windowOverlays) -- the fit, its band, the baseline and the peaks
// exactly as drawn. A project saved BEFORE that has only the dataset's saved
// `fitSpec`; this module redraws THAT fit for the focused window by
// EVALUATING its saved model at its saved parameters over the rows it was
// fitted on (lib/savedFitCurve, the evaluation Open plot uses) -- never by
// fitting again.
//
// Fail closed, and say why (status line):
//   * a fit marked stale on load (its data changed after the save,
//     `staleFits`): no curve -- the Library's "out of date" mark stands;
//   * a fit that never recorded its X/Y, or whose X/Y is not a curve on the
//     window's own plot (lib/fitDrawBinding, then the window's view through
//     lib/overlayPlacement): no curve;
//   * the model cannot be evaluated (unknown model, backend error): no curve;
//   * anything changed while evaluating (focus, data, fit, an overlay drawn
//     meanwhile): nothing is written.
// Loaded lazily, after hydration, so none of this is on the eager path.
// (store/windowOverlays.restoreOverlays seeds a lane-C figure first, then calls this.)

import { fitDrawBinding, fitDrawRefusal } from "../lib/fitDrawBinding";
import { snapshotView } from "../lib/plotview";
import { evaluateSavedFit } from "../lib/savedFitCurve";
import { useApp } from "./useApp";
import { fitPlaced } from "./windowOverlays";

/** Redraw the focused window's dataset's saved fit from its parameters, when
 *  nothing restored a curve for it. Resolves to what it did, for tests. */
export async function restoreSavedFitOverlay(): Promise<"drawn" | "refused" | "none"> {
  const s = useApp.getState();
  if (s.fitOverlay) return "none"; // the figure's own saved curve was restored
  const window = s.plotWindows.find((w) => w.id === s.focusedWindowId);
  const datasetId = window?.kind === "plot" ? window.datasetId : null;
  const dataset = datasetId ? s.datasets.find((d) => d.id === datasetId) : undefined;
  const spec = dataset?.fitSpec;
  if (!dataset || !spec || dataset.pending) return "none";
  const say = (why: string): "refused" => {
    useApp.getState().setStatus(`saved fit not redrawn on "${dataset.name}": ${why}`);
    return "refused";
  };
  if (s.staleFits.includes(dataset.id)) return say("its data changed after the fit (out of date); re-fit to redraw it");
  if (!spec.params?.length) return say("the saved fit has no parameter values");
  if (spec.yKey === undefined) return say(fitDrawRefusal(spec));
  const binding = fitDrawBinding(dataset, { channels: [spec.yKey], xChannel: spec.xKey }, spec);
  if (!binding) return say(fitDrawRefusal(spec));
  // Review #7: the window's OWN view must draw the fitted curve on its X
  // (placement, lib/overlayPlacement) -- else it would be drawn nowhere and
  // only reported "left out" by every export of the figure.
  const probe = { datasetId: dataset.id, binding, y: dataset.data.time.map(() => null) };
  const view = snapshotView(s);
  if (!fitPlaced(dataset, view, probe)) {
    return say("the fitted curve is not on this plot (another X, or the fitted Y is hidden or not plotted)");
  }
  const y = await evaluateSavedFit(dataset, spec, spec.params);
  const now = useApp.getState();
  const current = now.datasets.find((d) => d.id === dataset.id);
  if (now.fitOverlay || now.focusedWindowId !== s.focusedWindowId || current?.data !== dataset.data || current.fitSpec !== spec) {
    return "none"; // something else happened meanwhile: never overwrite it
  }
  if (typeof y === "string") return say(`its model could not be evaluated (${y})`);
  now.setFitOverlay({ datasetId: dataset.id, binding, y });
  return "drawn";
}
