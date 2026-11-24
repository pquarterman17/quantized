// Reflectivity fit-mode: the "fit curves" actions — Add fit curves, Send to
// figure and Open log plot. Split out of useReflFit.ts (its 500-line module
// ceiling); behaviour unchanged. Store access is by selector only.

import type { ReflFitResult } from "../../../lib/api/reflectivity";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { curveDatasetFor, curveDatasets, existingFitDatasetIds, liveCurves, presentIds } from "./reflFitCurves";
import { commitReflFitOutputs, REFL_CURVES_PRODUCER } from "./reflFitOutputsCommit";
import type { ReflFitRecord } from "./reflFitRecord";
import { useReflFitFigure } from "./useReflFitFigure";
import type { Radiation } from "./useReflectivity";

export interface ReflFitCurveInputs {
  result: ReflFitResult | null;
  stale: boolean;
  liveRecord: ReflFitRecord | null;
  datasets: Dataset[];
  curveIds: string[];
  setCurveIds: (ids: string[]) => void;
  /** The radiation the fit itself ran with (null: use the Model-mode pick). */
  fitRadiation: Radiation | null;
  radiation: Radiation;
}

export interface ReflFitCurveActions {
  addCurves: () => string[];
  sendToFigure: () => void;
  openLogPlot: () => void;
}

export function useReflFitCurveActions(inp: ReflFitCurveInputs): ReflFitCurveActions {
  const createWindow = useApp((s) => s.createWindow);
  const setStatus = useApp((s) => s.setStatus);
  const sendFigure = useReflFitFigure();
  const { result, stale, liveRecord, datasets, curveIds, setCurveIds } = inp;

  function addCurves(): string[] {
    if (!result || stale) return [];
    // Reused only while every one is still in the library.
    if (presentIds(curveIds, datasets)) return curveIds;
    // ...or found by their provenance (durable across a reload).
    const earlier = liveRecord ? existingFitDatasetIds(liveRecord.id, datasets, result.curves.length + result.sld_profiles.length) : null;
    if (earlier) {
      setCurveIds(earlier);
      setStatus("the fit curves are already added; nothing was duplicated");
      return earlier;
    }
    // Named for, placed with, and pointing back at the fit's record
    // (reflFitCurves.ts); a fit whose record could not be stored (its datasets
    // deleted mid-fit) names them generically, with the fit's OWN radiation —
    // the Model-mode pick may have changed since.
    const fallback = { weighting: result.weighting, radiation: inp.fitRadiation ?? inp.radiation };
    // One multi-output result for the set, so each worksheet goes stale with its data (reflFitOutputsCommit.ts).
    const ids = commitReflFitOutputs("add reflectivity fit curves", REFL_CURVES_PRODUCER, liveRecord,
      curveDatasets(liveCurves(result), liveRecord, datasets, fallback));
    setCurveIds(ids);
    setStatus(`added ${ids.length} reflectivity-fit datasets`);
    return ids;
  }

  function sendToFigure(): void {
    if (!result || stale) return;
    const ids = addCurves();
    const base = liveRecord ? curveDatasetFor(liveRecord, datasets).base : "Reflectivity fit";
    if (ids.length) sendFigure({ ids, curves: liveCurves(result), weighting: result.weighting, base });
  }

  function openLogPlot(): void {
    const ids = addCurves();
    if (!ids.length) return;
    createWindow(ids[0], { ...defaultPlotView(), yScale: "log" }, "Reflectivity fit");
  }

  return { addCurves, sendToFigure, openLogPlot };
}
