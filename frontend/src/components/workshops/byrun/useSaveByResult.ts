// "Save By result" for the shared By section (lane BY): records the CURRENT
// per-level rows as one analysis-batch result (lib/byLevelBatchResult), the
// same producer the worksheet batch uses, so a By run lands in the Library and
// the Result book. Opt-in per tool (a `toolId`); fails closed with a reason
// while levels are running, on a lazy preview, or when nothing has run.

import { useRef, useState } from "react";

import type { AnalysisResultValue } from "../../../lib/analysisResult";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { byLevelBatchResult } from "../../../lib/byLevelBatchResult";
import type { Dataset } from "../../../lib/types";
import { registerAnalysisResult } from "../../../store/analysisResultActions";
import { analysisBatchRuntime } from "../../../store/analysisSelection";
import { nextAnalysisResultId } from "../../../store/idSeq";
import { useApp } from "../../../store/useApp";
import type { ByLevelRow, ByLevelRunState } from "./useByLevelRun";

export interface ByResultSaveOptions {
  /** The tool id its worksheet batch uses ("distribution", "outlier-screening"). */
  toolId: string;
  /** Small, JSON-safe settings that interpret the saved table. */
  parameters?: Record<string, AnalysisResultValue>;
  /** The columns analysed on the worksheet (provenance). */
  xKey?: number | null;
  yKeys?: readonly number[];
}

export interface ByResultSave {
  /** Null when saving is possible; otherwise why not. */
  disabledReason: string | null;
  save: () => void;
}

export function useSaveByResult(
  tool: string,
  active: Dataset | null,
  headers: readonly string[],
  by: ByLevelRunState,
  options: ByResultSaveOptions | undefined,
): ByResultSave {
  const [saved, setSaved] = useState<{ rows: ByLevelRow[]; id: string } | null>(null);
  // An Undo removes the result: saving the same rows is then allowed again.
  const stillSaved = useApp((state) => saved !== null && state.analysisResults.some((result) => result.id === saved.id));
  // Synchronous twin of `saved`: a second click in the same tick sees it.
  const savedRef = useRef<{ rows: ByLevelRow[]; id: string } | null>(null);
  const byColumn = by.byOptions.find((option) => option.index === by.byCol) ?? null;
  const disabledReason = !options ? "Saving is not offered for this tool."
    : !active || !byColumn ? "Pick a By column first."
      : active.pending ? "Wait for the full worksheet to load."
        : !by.current ? "Wait for every level to finish."
          : by.rows.length === 0 ? "No levels have run yet."
            : stillSaved && saved?.rows === by.rows ? "This By result is already saved."
              : null;
  const save = (): void => {
    if (disabledReason || !options || !active || !byColumn) return;
    const last = savedRef.current;
    if (last?.rows === by.rows && analysisBatchRuntime().analysisResults.some((entry) => entry.id === last.id)) return;
    const result = byLevelBatchResult({
      id: nextAnalysisResultId(),
      createdAt: new Date().toISOString(),
      toolId: options.toolId,
      label: tool,
      datasetId: active.id,
      sourceFingerprint: analysisDataFingerprint(active),
      byColumn,
      headers,
      rows: by.rows,
      omittedLevels: Math.max(0, by.totalLevels - by.levels.length),
      ...(options.parameters ? { parameters: options.parameters } : {}),
      ...(options.xKey !== undefined ? { xKey: options.xKey } : {}),
      ...(options.yKeys ? { yKeys: options.yKeys } : {}),
    });
    if (typeof result === "string") {
      analysisBatchRuntime().setStatus(`${tool} By result not saved: ${result}`);
      return;
    }
    analysisBatchRuntime().recordHistory(`save ${tool.toLowerCase()} by ${byColumn.label}`);
    registerAnalysisResult(result);
    savedRef.current = { rows: by.rows, id: result.id };
    setSaved(savedRef.current);
    analysisBatchRuntime().setStatus(`${tool} by ${byColumn.label} saved: ${by.rows.length} levels — the result is in the Library`);
  };
  return { disabledReason, save };
}
