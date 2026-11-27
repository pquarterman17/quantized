import { useEffect, useMemo } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { multivariateQuestion, rangedSnapshotKey } from "../../../lib/snapshotResultKey";
import type { CorrelationResponse, PCAResponse } from "../../../lib/api";
import { multivariateResultTable, multivariateResultTableShapes, multivariateResultTables, multivariateSnapshotMatchesRecipe, type MultivariateRecipe, type MultivariateSnapshot } from "../../../lib/multivariateAnalysisResult";
import type { Dataset } from "../../../lib/types";
import { useMultivarStore } from "../../../store/multivar";
import { publishMultivariateResult } from "../../../store/multivariateResults";
import { useApp } from "../../../store/useApp";
import { useSavedRowRange } from "../resultbook/useSavedRowRange";
import { useLiveTables, useToolResultBook, type ToolResultBook } from "../resultbook/useToolResultBook";

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
  /** The in-tool result book's actions (lane RB4). */
  book: ToolResultBook;
  /** The live tables' titles and sizes (no rows built), or null. */
  tableShapes: { title: string; rows: number; cols: number }[] | null;
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
  const liveRange = useSavedRowRange("multivariate-analysis", args.active);
  const savedKey = args.active && fingerprint
    ? rangedSnapshotKey("multivariate-analysis", args.active.id, fingerprint, multivariateQuestion(recipe), liveRange) : null;
  const { labels, sourceRows, inputRows, correlation, pca } = args;
  const snapshot = useMemo<MultivariateSnapshot | null>(() => correlation && pca ? {
    labels, sourceRows, inputRows, correlation, pca,
  } : null, [correlation, inputRows, labels, pca, sourceRows]);
  const complete = !!snapshot && multivariateSnapshotMatchesRecipe(recipe, snapshot);
  // The book reads the snapshot only while it answers the current question.
  const bookSnapshot = complete && !args.busy ? snapshot : null;
  const liveTables = useLiveTables(bookSnapshot, multivariateResultTables);
  const tableShapes = useMemo(() => bookSnapshot ? multivariateResultTableShapes(bookSnapshot) : null, [bookSnapshot]);
  // One table built per title, on demand, cached for this computation.
  const liveTableOf = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof multivariateResultTable>>();
    return (title: string) => {
      if (!bookSnapshot) return null;
      if (!cache.has(title)) cache.set(title, multivariateResultTable(bookSnapshot, title));
      return cache.get(title) ?? null;
    };
  }, [bookSnapshot]);
  const book = useToolResultBook({
    savedKey, liveTables, liveTableOf, liveTitles: () => tableShapes?.map((shape) => shape.title) ?? null,
  });
  // One saved-result lookup per tool: the book's.
  const savedResultExists = book.saved !== null;
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
  return { canSaveResult, saveResultDisabledReason, saveResult, book, tableShapes };
}
