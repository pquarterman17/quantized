import { useEffect, useMemo } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { CorrelationResponse, PCAResponse } from "../../../lib/api";
import { multivariateSnapshotMatchesRecipe, type MultivariateRecipe, type MultivariateSnapshot } from "../../../lib/multivariateAnalysisResult";
import type { Dataset } from "../../../lib/types";
import { useMultivarStore } from "../../../store/multivar";
import { matchesMultivariateResult, publishMultivariateResult } from "../../../store/multivariateResults";
import { useApp } from "../../../store/useApp";

interface BridgeArgs {
  active: Dataset | null;
  selected: number[];
  setSelected: (columns: number[]) => void;
  method: MultivariateRecipe["method"];
  setMethod: (method: MultivariateRecipe["method"]) => void;
  standardize: boolean;
  setStandardize: (standardize: boolean) => void;
  pcX: number;
  setPcX: (component: number) => void;
  pcY: number;
  setPcY: (component: number) => void;
  labels: string[];
  sourceRows: number[];
  inputRows: number;
  correlation: CorrelationResponse | null;
  pca: PCAResponse | null;
  busy: boolean;
}

export function useMultivarResultBridge(args: BridgeArgs): {
  canSaveResult: boolean;
  saveResultDisabledReason: string | null;
  saveResult: () => string | null;
} {
  const request = useMultivarStore((state) => state.request);
  const consumeRequest = useMultivarStore((state) => state.consumeRequest);
  const setStatus = useApp((state) => state.setStatus);
  const { setMethod, setPcX, setPcY, setSelected, setStandardize } = args;
  useEffect(() => {
    if (!request) return;
    setSelected([...request.columns]);
    setMethod(request.method);
    setStandardize(request.standardize);
    setPcX(request.pcX);
    setPcY(request.pcY);
    consumeRequest();
  }, [consumeRequest, request, setMethod, setPcX, setPcY, setSelected, setStandardize]);

  const recipe = useMemo<MultivariateRecipe>(() => ({
    columns: [...args.selected], method: args.method, standardize: args.standardize,
    pcX: args.pcX, pcY: args.pcY,
  }), [args.method, args.pcX, args.pcY, args.selected, args.standardize]);
  const channelCount = args.active?.data.labels.length ?? 0;
  const recipeValid = recipe.columns.length >= 2 && new Set(recipe.columns).size === recipe.columns.length &&
    recipe.columns.every((index) => Number.isInteger(index) && index >= -1 && index < channelCount) &&
    recipe.pcX >= 0 && recipe.pcX < recipe.columns.length && recipe.pcY >= 0 && recipe.pcY < recipe.columns.length;
  const fingerprint = useMemo(
    () => args.active && !args.active.pending ? analysisDataFingerprint(args.active) : null,
    [args.active],
  );
  const savedResultExists = useApp((state) => !!args.active && !!fingerprint &&
    state.analysisResults.some((result) => matchesMultivariateResult(result, args.active!.id, fingerprint, recipe)));
  const snapshot: MultivariateSnapshot | null = args.correlation && args.pca ? {
    labels: args.labels, sourceRows: args.sourceRows, inputRows: args.inputRows,
    correlation: args.correlation, pca: args.pca,
  } : null;
  const complete = !!snapshot && multivariateSnapshotMatchesRecipe(recipe, snapshot);
  const canSaveResult = !!args.active && !args.active.pending && recipeValid && !args.busy && complete && !savedResultExists;
  const saveResultDisabledReason = canSaveResult ? null
    : !args.active ? "Select a dataset before saving."
      : args.active.pending ? "Load the full worksheet before saving this result."
        : !recipeValid ? "Select at least two valid columns and PCA axes."
          : args.busy || !args.correlation || !args.pca ? "Wait for the current correlation and PCA analyses to finish."
            : !complete ? "The correlation and PCA row counts do not match the current complete rows."
              : savedResultExists ? "This multivariate result is already saved." : "This result cannot be saved yet.";
  const saveResult = (): string | null => {
    if (savedResultExists) {
      setStatus("this multivariate result is already saved");
      return null;
    }
    if (!args.active || !snapshot || !canSaveResult) {
      setStatus("wait for the current multivariate analysis before saving a result");
      return null;
    }
    return publishMultivariateResult(args.active, recipe, {
      ...snapshot, labels: [...snapshot.labels], sourceRows: [...snapshot.sourceRows],
    });
  };
  return { canSaveResult, saveResultDisabledReason, saveResult };
}
