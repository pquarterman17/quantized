// Clustering's result-contract bridge, the useTimeSeriesResultBridge pattern:
// key the shown result by value (source, analysis-view fingerprint, tool,
// columns, options), feed the in-tool result book the tables the save writes,
// and Save as one undo step (store/snapshotResultSave: no duplicate, fail
// closed on a changed source). Reopening a saved result restores the recorded
// tool, columns and options (`restoredClusterOptions`: known keys of the same
// type only, so a recipe from another build cannot inject a setting).

import { useMemo } from "react";

import { analysisDataFingerprint } from "../../../../lib/analysisResultFreshness";
import { clusterAnalysisResult, clusterResultTables, type ClusterSnapshot } from "../../../../lib/clusterAnalysisResult";
import { rangedSnapshotKey } from "../../../../lib/snapshotResultKey";
import { CLUSTER_RESULT, clusterQuestion, type ClusterRecipe } from "../../../../lib/toolResultKinds";
import type { Dataset } from "../../../../lib/types";
import { publishSnapshotResult } from "../../../../store/snapshotResultSave";
import { useSavedRowRange } from "../../resultbook/useSavedRowRange";
import { useLiveTables, useToolResultBook, type ToolResultBook } from "../../resultbook/useToolResultBook";
import { DEFAULT_CLUSTER_OPTIONS, type ClusterOptions, type ClusterTool } from "./clusterRun";

type Flat = Record<string, number | string | boolean | null>;

/** The options that shaped the run (a start the run did not use is not part of the question). */
export function recipeOptions(tool: ClusterTool, opts: ClusterOptions): Flat {
  const o = { ...opts[tool] } as Flat;
  if (tool === "kmeans") {
    if (o["start"] !== "rows") delete o["startRows"];
    if (o["start"] !== "table") delete o["centreText"];
  }
  return o;
}

/** The saved options merged onto the defaults: only known keys of the same type (fail closed). */
export function restoredClusterOptions(recipe: ClusterRecipe): ClusterOptions {
  const base = DEFAULT_CLUSTER_OPTIONS[recipe.tool] as unknown as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(recipe.options)) {
    if (key in base && typeof base[key] === typeof value) merged[key] = value;
  }
  return { ...DEFAULT_CLUSTER_OPTIONS, [recipe.tool]: merged };
}

export interface ClusterBridge {
  book: ToolResultBook;
  canSaveResult: boolean;
  saveResultDisabledReason: string | null;
  saveResult: () => string | null;
}

export function useClusterResultBridge(args: {
  active: Dataset | null; tool: ClusterTool; columns: readonly number[]; opts: ClusterOptions;
  snapshot: ClusterSnapshot | null; busy: boolean;
}): ClusterBridge {
  const { active, tool, columns, opts, snapshot } = args;
  const recipe = useMemo<ClusterRecipe>(
    () => ({ tool, columns: [...columns], options: recipeOptions(tool, opts) }), [columns, opts, tool],
  );
  const fingerprint = useMemo(() => (active && !active.pending ? analysisDataFingerprint(active) : null), [active]);
  const liveRange = useSavedRowRange(CLUSTER_RESULT, active);
  const savedKey = active && fingerprint && snapshot
    ? rangedSnapshotKey(CLUSTER_RESULT, active.id, fingerprint, clusterQuestion(recipe), liveRange) : null;
  const liveTables = useLiveTables(snapshot, clusterResultTables);
  const book = useToolResultBook({ savedKey, liveTables });
  const saved = book.saved !== null;
  const canSaveResult = !!active && !active.pending && !args.busy && !!snapshot && !saved;
  const saveResultDisabledReason = canSaveResult ? null
    : !active ? "Select a dataset before saving."
      : active.pending ? "Load the full worksheet before saving this result."
        : args.busy || !snapshot ? "Run the tool before saving."
          : "This clustering result is already saved.";
  const saveResult = (): string | null => (active && snapshot && canSaveResult ? publishSnapshotResult({
    producerId: CLUSTER_RESULT, noun: "clustering result", source: active, question: clusterQuestion(recipe),
    changedMessage: "the clustering source changed or its full worksheet is not loaded; run again before saving",
    build: (id, live) => clusterAnalysisResult(id, live, recipe, snapshot),
  }) : null);
  return { book, canSaveResult, saveResultDisabledReason, saveResult };
}
