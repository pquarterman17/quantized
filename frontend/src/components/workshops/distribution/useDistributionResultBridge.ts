import { useEffect, useMemo, useRef, useState } from "react";

import type { DistributionFitPick, DistributionHistogram, DistributionNormality, DistributionRankedFit } from "../../../lib/distributionAnalysisResult";
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
  const snapshotToken = useMemo(() => ({
    active: args.active, col: args.col, byCol: args.byCol, fitDist: args.fitDist,
    compareOpen: args.compareOpen, percentileInput: args.percentileInput,
    label: args.label, byLabel: args.byLabel, hist: args.hist, desc: args.desc,
    norm: args.norm, normNote: args.normNote, byLevels: args.byLevels,
    byResults: args.byResults, byTotalLevels: args.byTotalLevels,
    rankedFits: args.rankedFits, rankingMetric: args.rankingMetric,
    quantiles: args.quantiles, percentileValue: args.percentileValue, skipped: args.skipped,
  }), [
    args.active, args.col, args.byCol, args.fitDist, args.compareOpen, args.percentileInput,
    args.label, args.byLabel, args.hist, args.desc, args.norm, args.normNote,
    args.byLevels, args.byResults, args.byTotalLevels, args.rankedFits, args.rankingMetric,
    args.quantiles, args.percentileValue, args.skipped,
  ]);
  const [saved, setSaved] = useState<{ id: string; token: object } | null>(null);
  const savedRef = useRef<{ id: string; token: object } | null>(null);
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

  const partitioned = args.byLevels.length > 0;
  const complete = partitioned
    ? args.byResults.length === args.byLevels.length
    : args.desc !== null;
  const fitRequested = !partitioned && (args.fitDist !== "none" || args.compareOpen);
  const canSaveResult = !!args.active && !args.active.pending && complete &&
    !args.busy && !args.byBusy && (!fitRequested || (!args.fitBusy && args.fitsReady)) &&
    !(savedResultExists && saved?.token === snapshotToken);

  const saveResult = (): string | null => {
    if (savedRef.current?.token === snapshotToken && hasDistributionResult(savedRef.current.id)) {
      setStatus("this Distribution result is already saved");
      return null;
    }
    if (!args.active || !canSaveResult) {
      setStatus("wait for the full Distribution analysis before saving a result");
      return null;
    }
    const savedFit = partitioned ? "none" : args.fitDist;
    const id = publishDistributionResult(args.active, {
      col: args.col, byCol: partitioned ? args.byCol : null, fitDist: savedFit,
      compareOpen: partitioned ? false : args.compareOpen, percentileInput: args.percentileInput,
    }, {
      label: args.label, byLabel: partitioned ? args.byLabel : null, hist: partitioned ? null : args.hist,
      desc: partitioned ? null : args.desc,
      norm: partitioned ? null : args.norm, normNote: partitioned ? null : args.normNote, levels: args.byResults,
      totalLevels: args.byTotalLevels, rankedFits: partitioned ? [] : args.rankedFits,
      rankingMetric: args.rankingMetric, quantiles: partitioned ? null : args.quantiles,
      percentileValue: partitioned ? null : args.percentileValue, skipped: partitioned ? [] : args.skipped,
    });
    if (id) {
      const record = { id, token: snapshotToken };
      savedRef.current = record;
      setSaved(record);
    }
    return id;
  };
  return { canSaveResult, saveResult };
}
