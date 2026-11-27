import { useEffect, useMemo } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { outlierQuestion, rangedSnapshotKey } from "../../../lib/snapshotResultKey";
import { outlierScreeningResultTables, type OutlierScreeningRecipe, type OutlierScreeningSnapshot } from "../../../lib/outlierScreeningAnalysisResult";
import type { Dataset } from "../../../lib/types";
import { useOutlierScreeningStore } from "../../../store/outlierScreening";
import { publishOutlierScreeningResult } from "../../../store/outlierScreeningResults";
import { useApp } from "../../../store/useApp";
import { useSavedRowRange } from "../resultbook/useSavedRowRange";
import { useLiveTables, useToolResultBook, type ToolResultBook } from "../resultbook/useToolResultBook";

interface BridgeArgs {
  active: Dataset | null;
  recipe: OutlierScreeningRecipe;
  setCol: (value: number) => void;
  setMethod: (value: OutlierScreeningRecipe["method"]) => void;
  setAlpha: (value: number) => void;
  setK: (value: number) => void;
  setThreshold: (value: number) => void;
  snapshot: OutlierScreeningSnapshot | null;
  busy: boolean;
  resultCurrent: boolean;
}

export function useOutlierScreeningResultBridge(args: BridgeArgs): {
  canSaveResult: boolean; saveResultDisabledReason: string | null; saveResult: () => string | null;
  /** The in-tool result book's actions (lane RB3). */
  book: ToolResultBook;
} {
  const request = useOutlierScreeningStore((state) => state.request);
  const consumeRequest = useOutlierScreeningStore((state) => state.consumeRequest);
  const setStatus = useApp((state) => state.setStatus);
  const { setAlpha, setCol, setK, setMethod, setThreshold } = args;
  useEffect(() => {
    if (!request) return;
    setCol(request.col); setMethod(request.method); setAlpha(request.alpha);
    setK(request.k); setThreshold(request.threshold); consumeRequest();
  }, [consumeRequest, request, setAlpha, setCol, setK, setMethod, setThreshold]);

  const channelCount = args.active?.data.labels.length ?? 0;
  const recipeValid = Number.isInteger(args.recipe.col) && args.recipe.col >= -1 && args.recipe.col < channelCount &&
    args.recipe.alpha > 0 && args.recipe.alpha < 1 && Number.isFinite(args.recipe.alpha) &&
    Number.isInteger(args.recipe.k) && args.recipe.k >= 1 &&
    args.recipe.threshold > 0 && Number.isFinite(args.recipe.threshold);
  const fingerprint = useMemo(
    () => args.active && !args.active.pending ? analysisDataFingerprint(args.active) : null,
    [args.active],
  );
  const liveRange = useSavedRowRange("outlier-screening", args.active);
  const savedKey = args.active && fingerprint
    ? rangedSnapshotKey("outlier-screening", args.active.id, fingerprint, outlierQuestion(args.recipe), liveRange) : null;
  // A screen computed for other settings is not this question's table.
  const liveTables = useLiveTables(args.resultCurrent ? args.snapshot : null, outlierScreeningResultTables);
  const book = useToolResultBook({ savedKey, liveTables });
  // One saved-result lookup per tool: the book's.
  const savedResultExists = book.saved !== null;
  const canSaveResult = !!args.active && !args.active.pending && recipeValid && !args.busy &&
    args.resultCurrent && !!args.snapshot && !savedResultExists;
  const saveResultDisabledReason = canSaveResult ? null
    : !args.active ? "Select a dataset before saving."
      : args.active.pending ? "Load the full worksheet before saving this result."
        : !recipeValid ? "Choose valid screening settings before saving."
          : args.busy || !args.resultCurrent || !args.snapshot ? "Wait for the current outlier screen to finish."
            : savedResultExists ? "This outlier-screening result is already saved." : "This result cannot be saved yet.";
  const saveResult = (): string | null => {
    if (savedResultExists) {
      setStatus("this outlier-screening result is already saved");
      return null;
    }
    if (!args.active || !args.snapshot || !canSaveResult) {
      setStatus("wait for the current outlier screen before saving a result");
      return null;
    }
    const id = publishOutlierScreeningResult(args.active, args.recipe, args.snapshot);
    // Last used is written by a successful save, never by Apply (preset contract P4).
    if (id !== null) {
      const { method, threshold, alpha, k } = args.recipe;
      void import("./presetAdapter").then((m) => m.recordOutlierRun({ method, threshold, alpha, k })).catch(() => undefined);
    }
    return id;
  };
  return { canSaveResult, saveResultDisabledReason, saveResult, book };
}
