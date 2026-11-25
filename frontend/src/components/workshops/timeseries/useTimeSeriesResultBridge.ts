// Time series' result-contract bridge (owner decision 2026-11-25), the
// useFitModelResultBridge pattern: consume a reopen request (Library "Reopen in
// tool"), key the shown result by value (lib/snapshotResultKey: source,
// analysis-view fingerprint, tool + channel + options), feed the in-tool result
// book the tables the save writes, and Save as one undo step, refusing a
// duplicate or a source that changed since the run (store/snapshotResultSave).

import { useEffect, useMemo } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { snapshotResultKey } from "../../../lib/snapshotResultKey";
import { timeSeriesResultTables, type TimeSeriesSnapshot } from "../../../lib/timeSeriesAnalysisResult";
import { TIME_SERIES_RESULT, timeSeriesQuestion, type TimeSeriesRecipe } from "../../../lib/toolResultKinds";
import type { Dataset } from "../../../lib/types";
import { useToolResultRequest } from "../../../store/toolResultRequest";
import { publishTimeSeriesResult } from "../../../store/toolResultSave";
import { useLiveTables, useToolResultBook, type ToolResultBook } from "../resultbook/useToolResultBook";
import { DEFAULT_TS_OPTIONS, type TsOptions, type TsTab } from "./timeSeriesRun";

export const TS_SECTION: Readonly<Record<TsTab, "corr" | "stat" | "decomp" | "cp" | "arima">> = {
  correlogram: "corr", stationarity: "stat", decompose: "decomp", changepoint: "cp", arima: "arima",
};

/** The saved options merged onto the defaults: only known keys of the same type (fail closed). */
export function restoredOptions(recipe: TimeSeriesRecipe): TsOptions {
  const section = TS_SECTION[recipe.tool];
  const base = DEFAULT_TS_OPTIONS[section] as unknown as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(recipe.options)) {
    if (key in base && typeof base[key] === typeof value) merged[key] = value;
  }
  return { ...DEFAULT_TS_OPTIONS, allowIrregular: recipe.allowIrregular, [section]: merged };
}

export interface TimeSeriesBridge {
  book: ToolResultBook;
  canSaveResult: boolean;
  saveResultDisabledReason: string | null;
  saveResult: () => string | null;
}

export function useTimeSeriesResultBridge(args: {
  active: Dataset | null;
  tab: TsTab; col: number; opts: TsOptions;
  snapshot: TimeSeriesSnapshot | null;
  busy: boolean;
  restore: (recipe: TimeSeriesRecipe) => void;
}): TimeSeriesBridge {
  const request = useToolResultRequest((s) => s.timeSeries);
  const consume = useToolResultRequest((s) => s.consume);
  const { restore, active, tab, col, opts, snapshot } = args;
  useEffect(() => {
    if (!request) return;
    restore(request);
    consume("timeSeries");
  }, [consume, request, restore]);

  const recipe = useMemo<TimeSeriesRecipe>(() => ({
    tool: tab, col, allowIrregular: opts.allowIrregular,
    options: { ...(opts[TS_SECTION[tab]] as unknown as Record<string, number | string | boolean>) },
  }), [col, opts, tab]);
  const fingerprint = useMemo(() => (active && !active.pending ? analysisDataFingerprint(active) : null), [active]);
  const savedKey = active && fingerprint && snapshot ? snapshotResultKey(TIME_SERIES_RESULT, active.id, fingerprint, timeSeriesQuestion(recipe)) : null;
  const liveTables = useLiveTables(snapshot, timeSeriesResultTables);
  const book = useToolResultBook({ savedKey, liveTables });
  const saved = book.saved !== null;
  const canSaveResult = !!active && !active.pending && !args.busy && !!snapshot && !saved;
  const saveResultDisabledReason = canSaveResult ? null
    : !active ? "Select a dataset before saving."
      : active.pending ? "Load the full worksheet before saving this result."
        : args.busy || !snapshot ? "Run the tool before saving."
          : "This time-series result is already saved.";
  const saveResult = (): string | null => (active && snapshot && canSaveResult ? publishTimeSeriesResult(active, recipe, snapshot) : null);
  return { book, canSaveResult, saveResultDisabledReason, saveResult };
}
