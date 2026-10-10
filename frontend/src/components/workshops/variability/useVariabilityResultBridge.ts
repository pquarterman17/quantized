import { useEffect, useMemo } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { VariabilityRecipe } from "../../../lib/variabilityAnalysisResult";
import type { Dataset } from "../../../lib/types";
import type { VariabilityFactorLevel } from "../../../lib/variability";
import { useVariabilityStore } from "../../../store/variability";
import { matchesVariabilityResult, publishVariabilityResult } from "../../../store/variabilityResults";
import { useApp } from "../../../store/useApp";
import type { NestedAnovaResponse, VarianceComponentsResponse, VariabilitySummaryResponse } from "./useVariability";

interface BridgeArgs {
  active: Dataset | null;
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

export function useVariabilityResultBridge(args: BridgeArgs): { canSaveResult: boolean; saveResult: () => string | null } {
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
  const channelCount = args.active?.data.labels.length ?? 0;
  const recipeValid = [recipe.responseCol, recipe.factorACol, recipe.factorBCol]
    .every((index) => index >= -1 && index < channelCount) &&
    new Set([recipe.responseCol, recipe.factorACol, recipe.factorBCol]).size === 3;
  const fingerprint = useMemo(
    () => args.active && !args.active.pending ? analysisDataFingerprint(args.active) : null,
    [args.active],
  );
  const savedResultExists = useApp((state) => !!args.active && !!fingerprint &&
    state.analysisResults.some((result) => matchesVariabilityResult(result, args.active!.id, fingerprint, recipe)));
  const canSaveResult = !!args.active && !args.active.pending && recipeValid && !args.busy &&
    !!args.anova && !!args.summary && !savedResultExists;
  const saveResult = (): string | null => {
    if (savedResultExists) {
      setStatus("this variability result is already saved");
      return null;
    }
    const { active, anova, summary } = args;
    if (!active || !anova || !summary || !canSaveResult) {
      setStatus("wait for the full variability analysis before saving a result");
      return null;
    }
    return publishVariabilityResult(active, recipe, {
      responseLabel: args.responseLabel, factorALabel: args.factorALabel, factorBLabel: args.factorBLabel,
      levelLabels: args.levels.map((level) => ({
        aLabel: level.aLabel, bLabels: level.cells.map((cell) => cell.bLabel),
      })),
      anova, summary, varComp: args.varComp, varCompNote: args.varCompNote,
    });
  };
  return { canSaveResult, saveResult };
}
