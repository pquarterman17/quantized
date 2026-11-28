import { useEffect, useMemo } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { rangedSnapshotKey, variabilityQuestion } from "../../../lib/snapshotResultKey";
import { variabilityResultTables, type VariabilityRecipe, type VariabilitySnapshot } from "../../../lib/variabilityAnalysisResult";
import type { Dataset } from "../../../lib/types";
import type { VariabilityFactorLevel } from "../../../lib/variability";
import { useVariabilityStore } from "../../../store/variability";
import { publishVariabilityResult } from "../../../store/variabilityResults";
import { useApp } from "../../../store/useApp";
import { useSavedRowRange } from "../resultbook/useSavedRowRange";
import { useLiveTables, useToolResultBook, type ToolResultBook } from "../resultbook/useToolResultBook";
import type { NestedAnovaResponse, VarianceComponentsResponse, VariabilitySummaryResponse } from "./useVariability";

interface BridgeArgs {
  active: Dataset | null;
  /** `active` with its CSV text columns appended as channels: what the column picks index. */
  grouped: Dataset | null;
  responseCol: number;
  setResponseCol: (value: number) => void;
  factorACol: number;
  setFactorACol: (value: number) => void;
  factorBCol: number;
  setFactorBCol: (value: number) => void;
  responseLabel: string;
  factorALabel: string;
  factorBLabel: string;
  levels: VariabilityFactorLevel[];
  anova: NestedAnovaResponse | null;
  summary: VariabilitySummaryResponse | null;
  varComp: VarianceComponentsResponse | null;
  varCompNote: string | null;
  busy: boolean;
}

export function useVariabilityResultBridge(args: BridgeArgs): {
  canSaveResult: boolean;
  saveResultDisabledReason: string | null;
  saveResult: () => string | null;
  /** The in-tool result book's actions (lane RB3). */
  book: ToolResultBook;
} {
  const request = useVariabilityStore((state) => state.request);
  const consumeRequest = useVariabilityStore((state) => state.consumeRequest);
  const setStatus = useApp((state) => state.setStatus);
  const { setFactorACol, setFactorBCol, setResponseCol } = args;
  useEffect(() => {
    if (!request) return;
    setResponseCol(request.responseCol);
    setFactorACol(request.factorACol);
    setFactorBCol(request.factorBCol);
    consumeRequest();
  }, [consumeRequest, request, setFactorACol, setFactorBCol, setResponseCol]);

  const recipe = useMemo<VariabilityRecipe>(() => ({
    responseCol: args.responseCol, factorACol: args.factorACol, factorBCol: args.factorBCol,
  }), [args.factorACol, args.factorBCol, args.responseCol]);
  const channelCount = args.grouped?.data.labels.length ?? 0;
  const recipeValid = [recipe.responseCol, recipe.factorACol, recipe.factorBCol]
    .every((index) => index >= -1 && index < channelCount) &&
    new Set([recipe.responseCol, recipe.factorACol, recipe.factorBCol]).size === 3;
  const fingerprint = useMemo(
    () => args.active && !args.active.pending ? analysisDataFingerprint(args.active) : null,
    [args.active],
  );
  const liveRange = useSavedRowRange("variability-analysis", args.active);
  const savedKey = args.active && fingerprint
    ? rangedSnapshotKey("variability-analysis", args.active.id, fingerprint, variabilityQuestion(recipe), liveRange) : null;
  const { anova, summary, varComp, varCompNote, levels, responseLabel, factorALabel, factorBLabel } = args;
  // The ONE snapshot both Save and the book's Copy table read.
  const snapshot = useMemo<VariabilitySnapshot | null>(() => anova && summary ? {
    responseLabel, factorALabel, factorBLabel,
    levelLabels: levels.map((level) => ({ aLabel: level.aLabel, bLabels: level.cells.map((cell) => cell.bLabel) })),
    anova, summary, varComp, varCompNote,
  } : null, [anova, factorALabel, factorBLabel, levels, responseLabel, summary, varComp, varCompNote]);
  const liveTables = useLiveTables(snapshot, variabilityResultTables);
  const book = useToolResultBook({ savedKey, liveTables });
  // One saved-result lookup per tool: the book's.
  const savedResultExists = book.saved !== null;
  const canSaveResult = !!args.active && !args.active.pending && recipeValid && !args.busy &&
    !!args.anova && !!args.summary && !savedResultExists;
  const saveResultDisabledReason = canSaveResult ? null
    : !args.active ? "Select a dataset before saving."
      : args.active.pending ? "Load the full worksheet before saving this result."
        : !recipeValid ? "Response, Factor A, and Factor B must use three different valid columns."
          : args.busy || !args.anova || !args.summary ? "Wait for the variability analysis to finish."
            : savedResultExists ? "This variability result is already saved." : "This result cannot be saved yet.";
  const saveResult = (): string | null => {
    if (savedResultExists) {
      setStatus("this variability result is already saved");
      return null;
    }
    const { active } = args;
    if (!active || !snapshot || !canSaveResult) {
      setStatus("wait for the full variability analysis before saving a result");
      return null;
    }
    const id = publishVariabilityResult(active, recipe, snapshot);
    // Last used is written by a successful save, never by Apply (preset contract P4).
    if (id) void import("./presetAdapter").then((m) => m.recordVariabilityRun({ response: responseLabel, factorA: factorALabel, factorB: factorBLabel })).catch(() => undefined);
    return id;
  };
  return { canSaveResult, saveResultDisabledReason, saveResult, book };
}
