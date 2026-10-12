import { useRef, type Dispatch, type SetStateAction } from "react";

import type { AnalysisResult } from "../../../lib/analysisResult";
import { onLoadFailure, runLazy } from "../../../lib/runLazy";

export type AnalysisResultBusy = "recalculate" | "rerun" | "duplicate" | "freeze" |
  "figure" | "report" | "copy" | "export" | null;

const loadActions = () => runLazy(
  "Loading analysis result actions…",
  () => import("../../../store/analysisResultActions"),
);

/** Clipboard/download actions have a synchronous ref guard because two clicks
 * can arrive before React commits the busy state. The saved table-array
 * reference permits harmless envelope edits (such as notes) while refusing a
 * delayed action when the actual tables changed during lazy loading. */
export function useAnalysisResultInlineTableActions(
  result: AnalysisResult | undefined,
  busy: AnalysisResultBusy,
  setBusy: Dispatch<SetStateAction<AnalysisResultBusy>>,
  onFigureCreated?: () => void,
) {
  const running = useRef(false);
  const run = async (kind: "copy" | "export", tableIndex?: number): Promise<void> => {
    if (!result || busy || running.current) return;
    running.current = true;
    setBusy(kind);
    try {
      const tables = result.tables;
      await loadActions().then((actions) => kind === "copy"
        ? actions.copyAnalysisInlineTables(result.id, tableIndex, tables)
        : actions.exportAnalysisInlineTables(result.id, tableIndex, tables), onLoadFailure);
    } finally {
      running.current = false;
      setBusy(null);
    }
  };
  const createStatisticalFigure = async (draftKey: string): Promise<void> => {
    if (!result || busy || running.current) return;
    running.current = true;
    setBusy("figure");
    try {
      const tables = result.tables;
      const windowId = await loadActions().then(
        (actions) => actions.createAnalysisStatisticalFigure(result.id, draftKey, tables),
        () => { onLoadFailure(); return null; },
      );
      if (windowId) onFigureCreated?.();
    } finally {
      running.current = false;
      setBusy(null);
    }
  };
  return {
    copyInlineTables: (tableIndex?: number) => run("copy", tableIndex),
    exportInlineTables: (tableIndex?: number) => run("export", tableIndex),
    createStatisticalFigure,
  };
}
