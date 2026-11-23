// Curve Fit: the request half of "Guess" and "Fit", split out of useCurveFit
// (which sat at 499 of 500 lines) so the hook can sit on the workbench shell.
// Nothing here is React: the hook passes the state it owns in and gets the
// result back. A VALIDATION failure (nothing to fit, a bad start table, a
// worksheet that changed under the request) is a `FitRefusal`; the backend
// failing is any other Error. The panel shows them through WorkbenchMessage
// as a refusal and an error respectively.

import { dropGapRows } from "../../../lib/api/finitePairs";
import { fitModel } from "../../../lib/api";
import { autoGuessFor, displayFit, fitOverlayColumn, fitRowsOf } from "../../../lib/fitCurve";
import { activeRowIndices, droppedRows } from "../../../lib/rowstate";
import type { FitModel, FitOverlay, FitWeighting } from "../../../lib/types";
import { publishFitAnalysisResult } from "../../../store/publishFitAnalysisResult";
import { useApp } from "../../../store/useApp";
import { toast } from "../../../store/toasts";
import { fitStepParams, selectedFitData, throwFitSelectionRefusal } from "../../../lib/fitselection";
import { activeCorrectionNames, fitSpecFrom } from "../../../lib/fitselectionActions";
import { bindFitRowIdentity } from "../../../lib/fitRowIdentity";
import { boundsForWire, rowsAreDefault, type FitParamRow } from "../../../lib/fitParams";
import { dyForFit, weightRequestFields } from "../../../lib/fitweights";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { rememberCurveFitOverlay } from "../../../store/curveFitOverlay";
import { recordRecentModel } from "../../../lib/fitModelPicker";
import { Refusal as FitRefusal } from "../workbench/refusal";
import { parseFitStarts } from "./fitStarts";
import { fittedStatus, isLinearFamily, statusResult } from "./curveFitStatus";
import { fittedWeighting, retainFitted, type Fitted } from "../../../store/curveFitSession";

/** The fit cannot run on these inputs (as opposed to the backend failing). */
export { FitRefusal };

/** Resolved inputs for one run: what both Guess and Fit read. */
async function prepare(activeId: string) {
  // #38 deferred edge: never guess/fit against the small preview — resolve the
  // dataset's full data first (no-op if it isn't pending), then re-derive x/y
  // from the RESOLVED dataset and the selection as it is NOW (the user may
  // have changed the plotted channels while a lazy Origin book was loading).
  const ds = await useApp.getState().resolveDataset(activeId);
  if (!ds) return null;
  const state = useApp.getState();
  const seed = useAnalysisSelection.getState();
  const runSelection = seed.toolId === "curvefit" ? seed.selection?.items.find((item) => item.datasetId === ds.id) : undefined;
  const runXKey = runSelection?.xKey ?? state.xKey;
  const runYKeys = runSelection?.yKeys ?? state.yKeys;
  const localXy = selectedFitData(ds, runXKey, runYKeys, state.seriesOrder, runSelection);
  if (!localXy) {
    try {
      return throwFitSelectionRefusal(ds, runXKey, runYKeys, state.seriesOrder, runSelection);
    } catch (e) {
      throw new FitRefusal(e instanceof Error ? e.message : "nothing to fit");
    }
  }
  const fitXKey = localXy.xKey; // recorded X = the one the points came from (the Y's own X)
  const pairs = dropGapRows(localXy.x, localXy.y);
  if (pairs.x.length === 0) throw new FitRefusal("no finite X/Y pairs are available to fit");
  if (!pairs.complete) toast(`${pairs.n - pairs.keep.length} of ${pairs.n} rows are gaps; they were excluded from the fit.`);
  const n = ds.data.time.length;
  const kept = localXy.sourceRows ?? activeRowIndices(n, droppedRows(ds)); // the overlay is laid back onto these
  const rows = fitRowsOf(pairs.keep, kept, n);
  // x/y go by handle (lib/fitSource); a large fit comes back as a display curve
  const source = { data: ds.data, xKey: fitXKey, yKey: localXy.yKey };
  return { ds, localXy, fitXKey, pairs, n, kept, rows, source };
}

/** Auto-guess starting values (no statistics: a "guess only" result). */
export async function guessFit(activeId: string, modelName: string): Promise<Fitted | null> {
  const p = await prepare(activeId);
  if (!p) return null;
  const g = await autoGuessFor(modelName, p.pairs.x, p.pairs.y, p.source, p.rows);
  return { result: { params: g.p0 }, fitData: null, datasetId: p.ds.id, model: modelName, xKey: p.fitXKey, yKey: p.localXy.yKey };
}

export interface FitRunArgs {
  activeId: string;
  modelName: string;
  model: FitModel | undefined;
  paramRows: FitParamRow[];
  weightingFor: (yKey: number) => FitWeighting;
  /** The fit is complete and recorded: show it (before the status line is written). */
  onFitted: (done: Fitted) => void;
  setWeightNote: (note: string | null) => void;
}

/** Fit, then record it (FitSpec, macro step, Library result, overlay): the
 *  commit paths are unchanged by the workbench. Resolves null when the
 *  dataset is gone. */
export async function fitOnce(a: FitRunArgs): Promise<Fitted | null> {
  const p = await prepare(a.activeId);
  if (!p) return null;
  const { ds, localXy, fitXKey, pairs, n, kept, rows, source } = p;
  const { modelName, model } = a;
  // Resolve weighting -> dy over the SAME analysis rows as the fit; a
  // missing/invalid error column refits unweighted with a surfaced note.
  const weight = a.weightingFor(localXy.yKey);
  // Validated over the KEPT rows only: a gap row's sigma leaves with it.
  const keep = pairs.keep.map((index) => localXy.analysisRows?.[index] ?? index);
  const { dy, issue } = dyForFit(ds, localXy.yKey, weight, keep);
  const finiteDy = dy ? keep.map((index) => dy[index]!) : null;
  a.setWeightNote(issue ?? null);
  // #30: the user's starting values / bounds / fixed flags. An UNTOUCHED table
  // is the registry default, so it is neither sent nor recorded; in an EDITED
  // table the starts the user did not choose come from the data (fitStarts.ts).
  const parsed = await parseFitStarts(a.paramRows, model, modelName, pairs.x, pairs.y, source, rows);
  if (parsed.error) throw new FitRefusal(parsed.error);
  const custom = !rowsAreDefault(a.paramRows, model);
  const r = await displayFit(fitModel, {
    model: modelName,
    x: pairs.x,
    y: pairs.y,
    ...(finiteDy ? weightRequestFields(weight, finiteDy) : {}),
    ...(custom
      ? {
          p0: parsed.p0,
          lower: parsed.lower,
          upper: parsed.upper,
          ...(parsed.fixed.some(Boolean) ? { fixed: parsed.fixed } : {}),
        }
      : {}),
  }, modelName, rows, source, finiteDy ? weight : undefined);
  // A fit request can outlive an edit/reimport. Never attach its result or row
  // tokens to the replacement worksheet object it did not fit.
  if (useApp.getState().datasets.find((dataset) => dataset.id === ds.id) !== ds) {
    throw new FitRefusal("worksheet changed while fitting; run the fit again");
  }
  const done: Fitted = {
    result: r,
    fitData: {
      x: pairs.x, y: pairs.y, xKey: fitXKey, yKey: localXy.yKey, ...fittedWeighting(weight.mode, finiteDy),
      weightMode: finiteDy ? weight.mode : "none", scaleErrors: weight.scaleErrors !== false,
      ...(custom && parsed.fixed.some(Boolean) ? { fixed: parsed.fixed } : {}),
    },
    datasetId: ds.id,
    model: modelName,
    xKey: fitXKey,
    yKey: localXy.yKey,
  };
  a.onFitted(done);
  // Durable fit spec (audit P1 #3): records the plotted channels + the
  // weighting ACTUALLY used (unweighted if dy couldn't resolve) so the recalc
  // graph (#1) reproduces the original fit, not time/values[0].
  const effWeight: FitWeighting = finiteDy ? weight : { mode: "none" };
  // #30: record WHICH corrections the source carried, so a reproduction cannot
  // silently run on differently-preprocessed data.
  const spec = fitSpecFrom(
    modelName,
    fitXKey,
    {
      ...localXy,
      x: pairs.x,
      y: pairs.y,
      sourceRows: localXy.sourceRows ? pairs.keep.map((index) => localXy.sourceRows![index]) : undefined,
    },
    r,
    effWeight,
    activeCorrectionNames(ds.corrections),
    custom
      ? { p0: parsed.p0, lower: boundsForWire(parsed.lower), upper: boundsForWire(parsed.upper), fixed: parsed.fixed }
      : undefined,
  );
  // Same recipe into the typed step (#6) so a template/pipeline batch replays
  // THESE channels + weighting, and the pipeline view can edit the model
  // without losing the provenance.
  const bound = bindFitRowIdentity(ds, spec);
  useApp.getState().recordMacro(`Fit ${modelName}`, `qz.fit("${modelName}")`, {
    kind: "fit",
    params: fitStepParams(modelName, bound.spec),
  });
  useApp.getState().setFitSpec(ds.id, bound.spec, bound.rowIdentities);
  recordRecentModel(modelName); // the picker's Recent group: models a fit RAN with (lib/fitModelPicker)
  publishFitAnalysisResult(ds.id);
  // Say so: the status line otherwise kept its previous message (after a
  // template, "press Fit to run it" — with the fit already done).
  useApp.getState().setStatus(...fittedStatus(modelName, ds.name, await statusResult(r, pairs.y), { linear: isLinearFamily(model?.category), weights: done.fitData?.weights })); // warn when poor (UX8-D)
  retainFitted(done, useApp.getState().datasets.find((d) => d.id === ds.id) ?? null);
  // yFit aligns to the pruned analysis x; expanded back to the full row count
  // (null at dropped rows) it stays in register with the full-length plot x,
  // whether excluded rows are hidden or greyed.
  const column = fitOverlayColumn(r, pairs, kept, n);
  if (column) {
    const overlay: FitOverlay = { datasetId: ds.id, binding: { yKey: localXy.yKey, xKey: fitXKey }, ...column, curveFit: true };
    rememberCurveFitOverlay(overlay);
    useApp.getState().setFitOverlay(overlay);
    retainFitted(done, useApp.getState().datasets.find((d) => d.id === ds.id) ?? null, overlay);
  }
  return done;
}
