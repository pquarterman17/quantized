// Curve Fit: the live initial-guess preview (opt-in). Draws the model at the
// CURRENT start values on the plot, dotted and named "initial guess", before any
// fit is run, and follows every edit of the start table.
//
// What it is NOT: a fit result. It writes only lib/fitPreviewSlot (outside the
// store: no autosave, history, export, Library result, FitSpec or macro step),
// it is dropped when the panel closes or the toggle goes off, and it is cleared
// when a real fit lands (it comes back on the next edit of the start values).
//
// The curve is the registry model's own expression (lib/derivedFitModels,
// checked against calc.fit_models) evaluated by the worksheet formula evaluator
// on the client: no second model implementation, no request per keystroke. The
// only request is the data-driven auto start (`/fit/autoguess`) for rows the
// user has not typed, exactly the start the fit itself would use
// (lib/fitParams `autoStartRows`), made once per dataset + model and debounced.

import { useEffect, useMemo, useRef, useState } from "react";

import { dropGapRows } from "../../../lib/api/finitePairs";
import { fitModelExpr } from "../../../lib/derivedFitModels";
import { autoGuessFor } from "../../../lib/fitCurve";
import { autoStartRows, parseFitParams, type FitParamRow, type ParsedFitParams } from "../../../lib/fitParams";
import { previewShifted } from "../../../lib/fitPreviewCurve";
import { setFitPreview, type FitPreviewCurve } from "../../../lib/fitPreviewSlot";
import { ALL_HELD_ERROR } from "../../../lib/paramRowCheck";
import { tokenOf } from "../../../lib/previewKey";
import type { Dataset, FitModel } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useWorkbenchPreview } from "../workbench/useWorkbenchPreview";

/** The data-driven start is estimated on at most this many points: it is a
 *  starting guess, and a stride sample of a sorted scan keeps its shape. */
const GUESS_MAX_POINTS = 20000;

export interface FitPreviewInput {
  active: Dataset | null;
  model: FitModel | undefined;
  modelName: string;
  /** The fit's (x, y) as `selectedFitData` resolved them; null = nothing selected. */
  xy: { x: number[]; y: number[]; xKey: number | null } | null;
  /** The result of the last REAL fit (null when none, or only a guess). A new
   *  object landing clears the preview. */
  landed: object | null;
}

export interface FitPreviewState {
  /** Why no curve is on the plot (null when it is, or when off). */
  message: string | null;
  /** The numbers the curve is drawn from (typed starts, auto starts filled in); null when unavailable. */
  effective: number[] | null;
  /** The curve is on the plot right now. */
  drawn: boolean;
}

const stride = <T,>(a: T[]): T[] => (a.length <= GUESS_MAX_POINTS ? a : a.filter((_, i) => i % Math.ceil(a.length / GUESS_MAX_POINTS) === 0));

export function useFitPreview(enabled: boolean, rows: readonly FitParamRow[], input: FitPreviewInput): FitPreviewState {
  const { active, model, modelName, xy, landed } = input;
  const plotXKey = useApp((s) => s.xKey);
  const shifted = useApp((s) => previewShifted(s.waterfall, s.seriesStyles));
  const entry = enabled ? fitModelExpr(modelName) : undefined;
  const pairs = useMemo(() => (xy ? dropGapRows(xy.x, xy.y) : null), [xy]);
  const hasData = !!pairs && pairs.x.length > 0;
  const needGuess = !!entry && !!model && hasData && autoStartRows(rows, model).length > 0;

  const guess = useWorkbenchPreview<number[]>({
    key: needGuess && active && xy ? `${active.id}|${modelName}|${tokenOf(xy)}` : "",
    delayMs: 200,
    fallbackError: "auto start failed",
    run: async () => (await autoGuessFor(modelName, stride(pairs!.x), stride(pairs!.y), undefined, [])).p0,
  });

  const parsed = useMemo<ParsedFitParams | null>(() => {
    if (!entry || !model) return null;
    if (needGuess && !guess.current) return null;
    const g = needGuess ? guess.current ?? undefined : undefined;
    const r = parseFitParams(rows, model, g);
    // Every parameter held is no reason to refuse a PREVIEW (the fit would refuse; the curve is still defined).
    return r.error === ALL_HELD_ERROR ? parseFitParams(rows.map((x) => ({ ...x, fixed: false })), model, g) : r;
  }, [entry, model, rows, needGuess, guess.current]); // eslint-disable-line react-hooks/exhaustive-deps

  const key = JSON.stringify([active?.id, modelName, rows, xy?.xKey]);
  const keyRef = useRef(key);
  keyRef.current = key;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const seen = useRef(landed);
  useEffect(() => {
    if (landed && landed !== seen.current) setDismissed(keyRef.current);
    seen.current = landed;
  }, [landed]);
  const cleared = dismissed === key;

  const params = parsed && !parsed.error && entry && parsed.p0.length === entry.params.length ? parsed.p0 : null;
  const onPlotAxis = !!xy && xy.xKey === plotXKey;
  const drawable = onPlotAxis && !shifted;
  const curve = useMemo<FitPreviewCurve | null>(
    () => (enabled && entry && params && active && xy && !cleared && drawable ? { datasetId: active.id, xKey: xy.xKey, expr: entry.expr, params } : null),
    [enabled, entry, params, active, xy, cleared, drawable],
  );
  // Only an instance that has drawn a curve may touch the shared slot (one that never did must not clear another's).
  const owned = useRef(false);
  useEffect(() => {
    if (curve) owned.current = true;
    if (owned.current) setFitPreview(curve);
  }, [curve]);
  useEffect(() => () => { if (owned.current) setFitPreview(null); }, []);

  let message: string | null = null;
  if (enabled) {
    if (!entry) message = `No preview for ${modelName}: it has no closed-form expression that can be drawn here.`;
    else if (!hasData) message = "Nothing to preview: no finite X/Y data is selected.";
    else if (needGuess && guess.error) message = `No preview: could not estimate the auto start values (${guess.error}).`;
    else if (needGuess && !guess.current) message = "Estimating start values…";
    else if (parsed?.error) message = `No preview: ${parsed.error}`;
    else if (cleared) message = "A fit landed and replaced the preview. Edit a start value to preview again.";
    else if (shifted) message = "Not drawn: a waterfall or decade offset is shifting the plotted data.";
    else if (!onPlotAxis) message = "Not drawn: the plot's X is not the X channel being fitted.";
  }
  return { message, effective: params ? [...params] : null, drawn: curve !== null };
}
