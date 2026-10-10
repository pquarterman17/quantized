import { useEffect, useMemo, useRef, useState } from "react";

import type { FitYByXMode, FitYByXRecipe, FitYByXSnapshot } from "../../../lib/fitYByXAnalysisResult";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { Dataset } from "../../../lib/types";
import { useFitYByXStore } from "../../../store/fitYByX";
import { hasFitYByXResult, publishFitYByXResult } from "../../../store/fitYByXResults";
import { useApp } from "../../../store/useApp";
import type { BivariateResult, ContingencyResult, FitYByXKind, FitYByXLevelResult, OnewayResult } from "./useFitYByX";

interface BridgeArgs {
  active: Dataset | null;
  xCol: number;
  setXCol: (value: number) => void;
  yCol: number;
  setYCol: (value: number) => void;
  byCol: number | null;
  setByCol: (value: number | null) => void;
  order: number;
  setOrder: (value: number) => void;
  bandInterval: "confidence" | "prediction";
  setBandInterval: (value: "confidence" | "prediction") => void;
  kind: FitYByXKind;
  xLabel: string;
  yLabel: string;
  byLabel: string | null;
  oneway: OnewayResult | null;
  bivariate: BivariateResult | null;
  contingency: ContingencyResult | null;
  byLevels: readonly unknown[];
  byResults: FitYByXLevelResult[];
  byTotalLevels: number;
  busy: boolean;
  byBusy: boolean;
}

export function useFitYByXResultBridge(args: BridgeArgs): { canSaveResult: boolean; saveResult: () => string | null } {
  const request = useFitYByXStore((state) => state.request);
  const consumeRequest = useFitYByXStore((state) => state.consumeRequest);
  const setStatus = useApp((state) => state.setStatus);
  const { setBandInterval, setByCol, setOrder, setXCol, setYCol } = args;

  useEffect(() => {
    if (!request) return;
    setXCol(request.xCol);
    setYCol(request.yCol);
    setByCol(request.byCol);
    setOrder(request.order);
    setBandInterval(request.bandInterval);
    consumeRequest();
  }, [
    consumeRequest, request, setBandInterval, setByCol, setOrder, setXCol, setYCol,
  ]);

  const partitioned = args.byCol !== null;
  const recipe = useMemo<FitYByXRecipe>(() => ({
    xCol: args.xCol, yCol: args.yCol, byCol: partitioned ? args.byCol : null,
    order: args.order, bandInterval: args.bandInterval,
  }), [args.bandInterval, args.byCol, args.order, args.xCol, args.yCol, partitioned]);
  const sourceFingerprint = useMemo(
    () => args.active && !args.active.pending ? analysisDataFingerprint(args.active) : null,
    [args.active],
  );
  const mode: FitYByXMode | null = args.kind === "unsupported" ? null : args.kind;
  const snapshotKey = sourceFingerprint && args.active && mode
    ? JSON.stringify({ source: args.active.id, fingerprint: sourceFingerprint, recipe, mode }) : null;
  const [saved, setSaved] = useState<{ id: string; key: string } | null>(null);
  const savedRef = useRef<{ id: string; key: string } | null>(null);
  const savedResultExists = useApp((state) => !!saved && state.analysisResults.some((result) => result.id === saved.id));
  const directComplete = mode === "oneway" ? args.oneway !== null
    : mode === "bivariate" ? args.bivariate !== null
      : mode === "contingency" ? args.contingency !== null : false;
  const hasLandedLevel = mode !== null && args.byResults.some((result) => mode === "oneway"
    ? result.oneway !== undefined
    : mode === "bivariate" ? result.bivariate !== undefined : result.contingency !== undefined);
  const complete = partitioned
    ? args.byLevels.length > 0 && args.byResults.length === args.byLevels.length && hasLandedLevel
    : directComplete;
  const canSaveResult = !!args.active && !args.active.pending && !!mode && complete &&
    !args.busy && !args.byBusy && !(savedResultExists && snapshotKey !== null && saved?.key === snapshotKey);

  const saveResult = (): string | null => {
    if (snapshotKey !== null && savedRef.current?.key === snapshotKey && hasFitYByXResult(savedRef.current.id)) {
      setStatus("this Fit Y by X result is already saved");
      return null;
    }
    if (!args.active || !mode || !canSaveResult || snapshotKey === null) {
      setStatus("wait for the full Fit Y by X analysis before saving a result");
      return null;
    }
    const snapshot: FitYByXSnapshot = {
      mode, xLabel: args.xLabel, yLabel: args.yLabel, byLabel: partitioned ? args.byLabel : null,
      oneway: partitioned ? null : args.oneway,
      bivariate: partitioned ? null : args.bivariate,
      contingency: partitioned ? null : args.contingency,
      levels: partitioned ? args.byResults : [], totalLevels: partitioned ? args.byTotalLevels : 0,
    };
    const id = publishFitYByXResult(args.active, recipe, snapshot);
    if (id) {
      const record = { id, key: snapshotKey };
      savedRef.current = record;
      setSaved(record);
    }
    return id;
  };
  return { canSaveResult, saveResult };
}
