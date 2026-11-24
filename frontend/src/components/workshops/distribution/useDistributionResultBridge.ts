import { useEffect, useMemo } from "react";

import { distributionResultTables, type DistributionFitPick, type DistributionRecipe, type DistributionHistogram, type DistributionNormality, type DistributionRankedFit, type DistributionSnapshot } from "../../../lib/distributionAnalysisResult";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { distributionQuestion, snapshotResultKey } from "../../../lib/snapshotResultKey";
import type { CalcResult, Dataset } from "../../../lib/types";
import { publishDistributionResult } from "../../../store/distributionResults";
import { useDistributionRequestStore } from "../../../store/distribution";
import { useApp } from "../../../store/useApp";
import { useLiveTables, useToolResultBook, type ToolResultBook } from "../resultbook/useToolResultBook";
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

export function useDistributionResultBridge(args: BridgeArgs): {
  canSaveResult: boolean; saveResult: () => string | null;
  /** The in-tool result book's actions (lane RB3). */
  book: ToolResultBook;
} {
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
    ? snapshotResultKey("distribution-analysis", args.active.id, sourceFingerprint, distributionQuestion(savedRecipe))
    : null;

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
  // The summary and histogram have landed; the fits are separate, so a fit
  // recompute never disables Copy of the Summary / Histogram tables.
  const baseReady = !!args.active && !args.active.pending && complete && !args.busy && !args.byBusy;
  const fitsSettled = !fitRequested || (!args.fitBusy && args.fitsReady);
  // Everything the save needs has landed (the save adds: not already saved).
  const ready = baseReady && fitsSettled;
  // The ONE snapshot both Save and the book's Copy table read: null until the
  // summary lands; the fit tables only once the fits settled (so a copy never
  // pairs new data with old fits). Save needs `ready`, so it saves it whole.
  const { label, byLabel, hist, desc, norm, normNote, byResults, byTotalLevels, rankedFits, rankingMetric, quantiles, percentileValue, skipped } = args;
  const liveSnapshot = useMemo<DistributionSnapshot | null>(() => baseReady ? {
    label, byLabel: partitioned ? byLabel : null, hist: partitioned ? null : hist,
    desc: partitioned ? null : desc,
    norm: partitioned ? null : norm, normNote: partitioned ? null : normNote, levels: byResults,
    totalLevels: byTotalLevels, rankedFits: partitioned || !fitsSettled ? [] : rankedFits,
    rankingMetric, quantiles: partitioned || !fitsSettled ? null : quantiles,
    percentileValue: partitioned || !fitsSettled ? null : percentileValue, skipped: partitioned || !fitsSettled ? [] : skipped,
  } : null, [baseReady, fitsSettled, partitioned, label, byLabel, hist, desc, norm, normNote, byResults, byTotalLevels,
    rankedFits, rankingMetric, quantiles, percentileValue, skipped]);
  const liveTables = useLiveTables(liveSnapshot, distributionResultTables);
  const book = useToolResultBook({ savedKey: snapshotKey, liveTables });
  // One saved-result lookup per tool: the book's.
  const savedResultExists = book.saved !== null;
  const canSaveResult = ready && !savedResultExists;

  const saveResult = (): string | null => {
    if (savedResultExists) {
      setStatus("this Distribution result is already saved");
      return null;
    }
    if (!args.active || !canSaveResult || snapshotKey === null || !liveSnapshot) {
      setStatus("wait for the full Distribution analysis before saving a result");
      return null;
    }
    return publishDistributionResult(args.active, savedRecipe, liveSnapshot);
  };
  return { canSaveResult, saveResult, book };
}
