// Profiler's result-contract bridge (owner decision 2026-11-25): a profile is
// saved against a SAVED Fit Model result (picked in the Model list, or the
// saved result whose model equals the one Fit Model handed over), keyed by
// value (lib/snapshotResultKey: the Fit Model source and fingerprint, the Fit
// Model result id and digest, the settings, confidence and goal). A live fit
// that was never saved has nothing to reference: Save result says so.

import { useMemo } from "react";

import type { GoalSpec, ProfileResponse, ProfilerModel, ProfilerSettings } from "../../../lib/api/modelEvaluate";
import { FIT_MODEL_PRODUCER } from "../../../lib/fitModelRecipe";
import { profilerResultTables } from "../../../lib/profilerAnalysisResult";
import { snapshotResultKey } from "../../../lib/snapshotResultKey";
import { PROFILER_RESULT, fitModelDigest, profilerQuestion, type ProfilerRecipe } from "../../../lib/toolResultKinds";
import { profilerSaveBlocked, publishProfilerResult } from "../../../store/toolResultSave";
import { useApp } from "../../../store/useApp";
import { useLiveTables, useToolResultBook, type ToolResultBook } from "../resultbook/useToolResultBook";

export interface ProfilerBridge {
  book: ToolResultBook;
  canSaveResult: boolean;
  saveResultDisabledReason: string | null;
  saveResult: () => string | null;
}

export function useProfilerResultBridge(args: {
  sourceId: string; liveId: string; model: ProfilerModel | null;
  settings: ProfilerSettings; alpha: number; goalSpec: GoalSpec | null;
  profile: ProfileResponse | null; stale: boolean;
}): ProfilerBridge {
  const results = useApp((s) => s.analysisResults);
  const datasets = useApp((s) => s.datasets);
  const { sourceId, liveId, model, settings, alpha, goalSpec, profile, stale } = args;
  // The saved Fit Model result this profile would reference.
  const fit = useMemo(() => {
    if (sourceId !== liveId) return results.find((r) => r.id === sourceId && r.producer.id === FIT_MODEL_PRODUCER) ?? null;
    const wanted = model ? JSON.stringify(model) : null;
    return results.find((r) => r.producer.id === FIT_MODEL_PRODUCER && wanted !== null && JSON.stringify(r.parameters?.["model"] ?? null) === wanted) ?? null;
  }, [liveId, model, results, sourceId]);
  const recipe = useMemo<ProfilerRecipe | null>(() => fit && {
    fitResultId: fit.id, fitDigest: fitModelDigest(fit), settings: { ...settings }, alpha, goal: goalSpec,
  }, [alpha, fit, goalSpec, settings]);
  const shown = profile && !stale ? profile : null;
  const sourceDataset = fit?.sources[0]?.datasetId;
  const savedKey = recipe && shown && sourceDataset && fit?.sourceFingerprint
    ? snapshotResultKey(PROFILER_RESULT, sourceDataset, fit.sourceFingerprint, profilerQuestion(recipe)) : null;
  const liveTables = useLiveTables(shown, profilerResultTables);
  const book = useToolResultBook({ savedKey, liveTables });
  // Re-judged whenever the project's results or data change.
  const blocked = useMemo(() => profilerSaveBlocked(fit?.id ?? null), [fit, results, datasets]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveResultDisabledReason = book.saved ? "This profile is already saved."
    : !shown ? "Wait for the profile at these settings." : blocked;
  const saveResult = (): string | null => (recipe && shown && !saveResultDisabledReason ? publishProfilerResult(recipe, shown) : null);
  return { book, canSaveResult: saveResultDisabledReason === null, saveResultDisabledReason, saveResult };
}
