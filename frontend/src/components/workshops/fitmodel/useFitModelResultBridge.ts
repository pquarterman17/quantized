// Fit Model's result-contract bridge (GAP_AUDIT_9 G1), the
// useVariabilityResultBridge pattern: consume a reopen request (Library "Edit /
// rerun"), key the live result by value (lib/snapshotResultKey: source,
// analysis-view fingerprint, question), feed the in-tool result book the same
// tables the save writes, and Save as one undo step, refusing duplicates and a
// source that changed since the fit (store/snapshotResultSave).

import { useEffect, useMemo } from "react";

import type { FitModelResponse } from "../../../lib/api/statsModel";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { SaveColumnOptions } from "../../../lib/fitModelColumns";
import { fitModelResultTables, type FitModelSnapshot } from "../../../lib/fitModelAnalysisResult";
import { FIT_MODEL_PRODUCER, type FitModelRecipe } from "../../../lib/fitModelRecipe";
import { fitModelQuestion, snapshotResultKey } from "../../../lib/snapshotResultKey";
import type { Dataset } from "../../../lib/types";
import { useFitModelStore } from "../../../store/fitModel";
import { commitFitModelColumns } from "../../../store/fitModelColumns";
import { publishFitModelResult } from "../../../store/fitModelResults";
import { useApp } from "../../../store/useApp";
import { useLiveTables, useToolResultBook, type ToolResultBook } from "../resultbook/useToolResultBook";

interface BridgeArgs {
  active: Dataset | null;
  recipe: FitModelRecipe;
  setResponseCol: (col: number) => void;
  setTerms: (terms: number[][]) => void;
  setCenter: (center: boolean) => void;
  setKindOverrides: (kinds: Record<string, "continuous" | "nominal">) => void;
  responseLabel: string;
  termLabels: string[];
  rowIds: number[];
  fit: FitModelResponse | null;
  busy: boolean;
}

export function useFitModelResultBridge(args: BridgeArgs): {
  canSaveResult: boolean;
  saveResultDisabledReason: string | null;
  saveResult: () => string | null;
  /** Save predicted / residual / interval columns as an output worksheet (id, or null when refused). */
  saveColumns: (opts: SaveColumnOptions) => string | null;
  book: ToolResultBook;
} {
  const request = useFitModelStore((s) => s.request);
  const consumeRequest = useFitModelStore((s) => s.consumeRequest);
  const setStatus = useApp((s) => s.setStatus);
  const { setResponseCol, setTerms, setCenter, setKindOverrides } = args;
  useEffect(() => {
    if (!request) return;
    setResponseCol(request.responseCol);
    setTerms(request.terms.map((t) => [...t]));
    setCenter(request.center);
    setKindOverrides({ ...request.kinds });
    consumeRequest();
  }, [consumeRequest, request, setCenter, setKindOverrides, setResponseCol, setTerms]);

  const { active, recipe, fit, responseLabel, termLabels, rowIds } = args;
  const fingerprint = useMemo(() => (active && !active.pending ? analysisDataFingerprint(active) : null), [active]);
  const savedKey = active && fingerprint
    ? snapshotResultKey(FIT_MODEL_PRODUCER, active.id, fingerprint, fitModelQuestion(recipe)) : null;
  const snapshot = useMemo<FitModelSnapshot | null>(
    () => (fit ? { responseLabel, termLabels, rowIds, fit } : null),
    [fit, responseLabel, rowIds, termLabels],
  );
  const liveTables = useLiveTables(snapshot, fitModelResultTables);
  const book = useToolResultBook({ savedKey, liveTables });
  const saved = book.saved !== null;
  const canSaveResult = !!active && !active.pending && !args.busy && !!snapshot && !saved;
  const saveResultDisabledReason = canSaveResult ? null
    : !active ? "Select a dataset before saving."
      : active.pending ? "Load the full worksheet before saving this result."
        : args.busy || !snapshot ? "Fit the model before saving."
          : saved ? "This Fit Model result is already saved." : "This result cannot be saved yet.";
  const saveResult = (): string | null => {
    if (saved) {
      setStatus("this Fit Model result is already saved");
      return null;
    }
    if (!active || !snapshot || !canSaveResult) {
      setStatus("fit the model before saving a result");
      return null;
    }
    return publishFitModelResult(active, recipe, snapshot);
  };
  const saveColumns = (opts: SaveColumnOptions): string | null => {
    if (!active || !fit || !snapshot || args.busy) {
      setStatus("fit the model before saving columns");
      return null;
    }
    const unit = recipe.responseCol >= 0 ? active.data.units[recipe.responseCol] : active.data.metadata?.["x_column_unit"];
    return commitFitModelColumns(active, recipe, { fit, responseLabel, responseUnit: String(unit ?? ""), rowIds }, opts);
  };
  return { canSaveResult, saveResultDisabledReason, saveResult, saveColumns, book };
}
