import { useEffect, useMemo, useRef, useState } from "react";

import type { DistributionFitPick, DistributionRecipe, DistributionHistogram, DistributionNormality, DistributionRankedFit } from "../../../lib/distributionAnalysisResult";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { CalcResult, Dataset } from "../../../lib/types";
import { hasDistributionResult, publishDistributionResult } from "../../../store/distributionResults";
import { useDistributionRequestStore } from "../../../store/distribution";
import { useApp } from "../../../store/useApp";
import type { DistributionLevelResult, Quantiles, RankingMetric } from "./useDistribution";

interface BridgeArgs {
  active: Dataset | null;
  col: number;
  setCol: (col: number) => void;
  byCol: number | null;
  setByCol: (col: number | null) => void;
  fitDist: DistributionFitPick;
  setFitDist: (fit: DistributionFitPick) => void;
  compareOpen: boolean;
  setCompareOpen: (open: boolean) => void;
  percentileInput: number;
  setPercentileInput: (value: number) => void;
  label: string;
  byLabel: string | null;
  hist: DistributionHistogram | null;
  desc: CalcResult | null;
  norm: DistributionNormality | null;
  normNote: string | null;
  byLevels: readonly unknown[];
  byResults: DistributionLevelResult[];
  byTotalLevels: number;
  rankedFits: DistributionRankedFit[];
  rankingMetric: RankingMetric;
  quantiles: Quantiles | null;
  percentileValue: number | null;
  skipped: { dist: string; reason: string }[];
  busy: boolean;
  fitBusy: boolean;
  fitsReady: boolean;
  byBusy: boolean;
}

export function useDistributionResultBridge(args: BridgeArgs): { canSaveResult: boolean; saveResult: () => string | null } {
  const request = useDistributionRequestStore((state) => state.request);
  const consumeRequest = useDistributionRequestStore((state) => state.consumeRequest);
  const setStatus = useApp((state) => state.setStatus);
  const partitioned = args.byLevels.length > 0;
  // The exact recipe a Save would record (By mode drops the whole-column fit
  // controls, matching what `saveResult` publishes below).
  const savedRecipe = useMemo<DistributionRecipe>(() => ({
    col: args.col, byCol: partitioned ? args.byCol : null, fitDist: partitioned ? "none" : args.fitDist,
    compareOpen: partitioned ? false : args.compareOpen, percentileInput: args.percentileInput,
  }), [args.byCol, args.col, args.compareOpen, args.fitDist, args.percentileInput, partitioned]);
  // Duplicate guard keyed by VALUE: the source's analysis-view fingerprint
  // plus the saved question. An unrelated edit (a rename) rebuilds every
  // object identity and re-runs the analysis, but must not re-enable Save for
  // the same data and question; a real data or control change must.
  const sourceFingerprint = useMemo(
    () => (args.active && !args.active.pending ? analysisDataFingerprint(args.active) : null),
    [args.active],
  );
  const snapshotKey = sourceFingerprint && args.active
    ? JSON.stringify({ source: args.active.id, fingerprint: sourceFingerprint, recipe: savedRecipe })
    : null;
  const [saved, setSaved] = useState<{ id: string; key: string } | null>(null);
  const savedRef = useRef<{ id: string; key: string } | null>(null);
  const savedResultExists = useApp((state) => !!saved && state.analysisResults.some((result) => result.id === saved.id));

  useEffect(() => {
    if (!request) return;
    args.setCol(request.col);
    args.setByCol(request.byCol);
    args.setFitDist(request.fitDist);
    args.setCompareOpen(request.compareOpen);
    args.setPercentileInput(request.percentileInput);
    consumeRequest();
  }, [args, consumeRequest, request]);

  const complete = partitioned
    ? args.byResults.length === args.byLevels.length
    : args.desc !== null;
  const fitRequested = !partitioned && (args.fitDist !== "none" || args.compareOpen);
  const canSaveResult = !!args.active && !args.active.pending && complete &&
    !args.busy && !args.byBusy && (!fitRequested || (!args.fitBusy && args.fitsReady)) &&
    !(savedResultExists && snapshotKey !== null && saved?.key === snapshotKey);

  const saveResult = (): string | null => {
    if (snapshotKey !== null && savedRef.current?.key === snapshotKey && hasDistributionResult(savedRef.current.id)) {
      setStatus("this Distribution result is already saved");
      return null;
    }
    if (!args.active || !canSaveResult || snapshotKey === null) {
      setStatus("wait for the full Distribution analysis before saving a result");
      return null;
    }
    const id = publishDistributionResult(args.active, savedRecipe, {
      label: args.label, byLabel: partitioned ? args.byLabel : null, hist: partitioned ? null : args.hist,
      desc: partitioned ? null : args.desc,
      norm: partitioned ? null : args.norm, normNote: partitioned ? null : args.normNote, levels: args.byResults,
      totalLevels: args.byTotalLevels, rankedFits: partitioned ? [] : args.rankedFits,
      rankingMetric: args.rankingMetric, quantiles: partitioned ? null : args.quantiles,
      percentileValue: partitioned ? null : args.percentileValue, skipped: partitioned ? [] : args.skipped,
    });
    if (id) {
      const record = { id, key: snapshotKey };
      savedRef.current = record;
      setSaved(record);
    }
    return id;
  };
  return { canSaveResult, saveResult };
}
