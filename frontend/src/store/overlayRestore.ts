// Gap audit 6 lane K (B1): a fit curve survives reopening a project.
//
// Opening a .dwk or restoring the autosave starts from cleared overlay
// singletons (store/workspaceHydration). A figure saved since gap audit 5 lane
// C carries its overlays in its document and hydration seeds them back
// (store/windowOverlays) -- the fit, its band, the baseline and the peaks
// exactly as drawn. A project saved BEFORE that has only the dataset's saved
// `fitSpec`; this module redraws THAT fit for the focused window by
// EVALUATING its saved model at its saved parameters (lib/savedFitCurve, the
// evaluation Open plot uses) -- never by fitting again.
//
// Fail closed, and say why (status line):
//   * a fit marked stale on load (its data changed after the save,
//     `staleFits`): no curve -- the Library's "out of date" mark stands;
//   * a fit that never recorded its X/Y, or whose X/Y is not a curve on the
//     plot (lib/fitDrawBinding): no curve;
//   * the model cannot be evaluated (unknown model, backend error): no curve;
//   * anything changed while evaluating (focus, data, fit, an overlay drawn
//     meanwhile): nothing is written.
// Loaded lazily, after hydration, so none of this is on the eager path.
// (store/windowOverlays.restoreOverlays seeds a lane-C figure first, then calls this.)

import { fitDrawBinding, fitDrawRefusal } from "../lib/fitDrawBinding";
import { evaluateSavedFit } from "../lib/savedFitCurve";
import { useApp } from "./useApp";

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
  const y = await evaluateSavedFit(dataset, spec, spec.params, binding.xKey);
  const now = useApp.getState();
  const current = now.datasets.find((d) => d.id === dataset.id);
  if (now.fitOverlay || now.focusedWindowId !== s.focusedWindowId || current?.data !== dataset.data || current.fitSpec !== spec) {
    return "none"; // something else happened meanwhile: never overwrite it
  }
  if (typeof y === "string") return say(`its model could not be evaluated (${y})`);
  now.setFitOverlay({ datasetId: dataset.id, binding, y });
  return "drawn";
}
