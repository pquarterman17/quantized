// Save the Time series, DOE and Profiler result kinds (owner decision
// 2026-11-25) through the one snapshot entry point (store/snapshotResultSave):
// fail closed on a changed or still-loading source, idempotent by value, one
// undo step. A profile is saved only from a SAVED, current Fit Model result.

import { snapshotResultState } from "../lib/analysisResultFreshness";
import type { ProfileResponse } from "../lib/api/modelEvaluate";
import type { DoeEffectsResponse } from "../lib/api/doe";
import type { DoeMeta } from "../lib/doe";
import { doeDesignAnalysisResult, doeEffectsAnalysisResult } from "../lib/doeAnalysisResult";
import { profilerAnalysisResult } from "../lib/profilerAnalysisResult";
import { timeSeriesAnalysisResult, type TimeSeriesSnapshot } from "../lib/timeSeriesAnalysisResult";
import {
  DOE_DESIGN_RESULT, DOE_EFFECTS_RESULT, PROFILER_RESULT, TIME_SERIES_RESULT, doeDesignFingerprint, doeDesignQuestion,
  doeEffectsQuestion, profilerQuestion, timeSeriesQuestion,
  type DoeDesignRecipe, type DoeEffectsRecipe, type ProfilerRecipe, type TimeSeriesRecipe,
} from "../lib/toolResultKinds";
import type { Dataset } from "../lib/types";
import { publishSnapshotResult } from "./snapshotResultSave";
import { useApp } from "./useApp";

export function publishTimeSeriesResult(source: Dataset, recipe: TimeSeriesRecipe, snapshot: TimeSeriesSnapshot): string | null {
  return publishSnapshotResult({
    producerId: TIME_SERIES_RESULT, noun: "time-series result", source, question: timeSeriesQuestion(recipe),
    changedMessage: "the time-series source changed or its full worksheet is not loaded; run again before saving",
    build: (id, live) => timeSeriesAnalysisResult(id, live, recipe, snapshot),
  });
}

export function publishDoeDesignResult(source: Dataset, recipe: DoeDesignRecipe, meta: DoeMeta): string | null {
  return publishSnapshotResult({
    producerId: DOE_DESIGN_RESULT, noun: "design result", source, question: doeDesignQuestion(recipe),
    changedMessage: "a design column changed or the design worksheet is not fully loaded; generate the design again before saving",
    fingerprint: (dataset) => doeDesignFingerprint(recipe.designColumns, dataset),
    build: (id, live) => doeDesignAnalysisResult(id, live, recipe, meta),
  });
}

export function publishDoeEffectsResult(source: Dataset, recipe: DoeEffectsRecipe, meta: DoeMeta, out: DoeEffectsResponse): string | null {
  return publishSnapshotResult({
    producerId: DOE_EFFECTS_RESULT, noun: "design effects result", source, question: doeEffectsQuestion(recipe),
    changedMessage: "the design worksheet changed or is not fully loaded; wait for the effects to update before saving",
    build: (id, live) => doeEffectsAnalysisResult(id, live, recipe, meta, out),
  });
}

/** Why a profile of `fitResultId` cannot be saved now, or null. */
export function profilerSaveBlocked(fitResultId: string | null): string | null {
  const state = useApp.getState();
  const fit = fitResultId ? state.analysisResults.find((r) => r.id === fitResultId) : undefined;
  if (!fit) return "Save the Fit Model result first: a profile is saved against a saved Fit Model result.";
  const fresh = snapshotResultState(fit, state.datasets, state.analysisResults);
  return fresh === "current" ? null : fresh === "pending" ? "Load the Fit Model result's full source worksheet first."
    : "The Fit Model result is out of date or its source is missing; fit the model again first.";
}

export function publishProfilerResult(recipe: ProfilerRecipe, profile: ProfileResponse): string | null {
  const state = useApp.getState();
  const blocked = profilerSaveBlocked(recipe.fitResultId);
  const fit = state.analysisResults.find((r) => r.id === recipe.fitResultId);
  const source = fit && state.datasets.find((d) => d.id === fit.sources[0]?.datasetId);
  if (blocked || !fit || !source) {
    state.setStatus(blocked ?? "the Fit Model result's source worksheet is missing", "danger");
    return null;
  }
  return publishSnapshotResult({
    producerId: PROFILER_RESULT, noun: "profile", source, question: profilerQuestion(recipe),
    changedMessage: "the Fit Model source changed or its full worksheet is not loaded; fit the model again before saving a profile",
    precheck: () => profilerSaveBlocked(recipe.fitResultId),
    build: (id, live) => profilerAnalysisResult(id, fit, recipe, profile, undefined, live),
  });
}
