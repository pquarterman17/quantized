// Per-section actions of the result book (lane RB). Every action reuses an
// existing store command and its fail-closed checks; the book adds none:
//   Copy table          -> copyAnalysisInlineTables (one table, TSV)
//   Send to report      -> sendAnalysisInlineTableToReport (that table; current only)
//   Open as worksheet   -> freezeAnalysisOutputs (the table's "tbl:<i>" output)
//   Create editable figure -> createAnalysisStatisticalFigure (via the shared hook)
// The ref guard stops a double click that lands before React commits `busy`.

import { useRef, type Dispatch, type SetStateAction } from "react";

import type { AnalysisResult } from "../../../../lib/analysisResult";
import { onLoadFailure, runLazy } from "../../../../lib/runLazy";
import { openWorksheet } from "../../../../store/worksheetOpen";
import { useAnalysisResultInlineTableActions, type AnalysisResultBusy } from "../useAnalysisResultInlineTableActions";

const loadActions = () => runLazy("Loading analysis result actions…", () => import("../../../../store/analysisResultActions"));
const loadFreeze = () => runLazy("Loading freeze actions…", () => import("../../../../store/analysisResultFreeze"));

export function useResultBookActions(
  result: AnalysisResult,
  busy: AnalysisResultBusy,
  setBusy: Dispatch<SetStateAction<AnalysisResultBusy>>,
  onClose: () => void,
) {
  const inline = useAnalysisResultInlineTableActions(result, busy, setBusy, onClose);
  const running = useRef(false);
  const guarded = async (kind: Exclude<AnalysisResultBusy, null>, run: () => Promise<void>): Promise<void> => {
    if (busy || running.current) return;
    running.current = true;
    setBusy(kind);
    try { await run(); } finally {
      running.current = false;
      setBusy(null);
    }
  };
  const report = (tableIndex: number) => guarded("report", async () => {
    await loadActions().then((m) => m.sendAnalysisInlineTableToReport(result.id, tableIndex), onLoadFailure);
  });
  const openTable = (tableIndex: number) => guarded("freeze", async () => {
    // The table object the user is looking at is the freeze identity: a
    // result edited meanwhile refuses inside freezeAnalysisOutputs.
    const table = result.tables?.[tableIndex];
    if (!table) return;
    const ids = await loadFreeze().then(
      (m) => m.freezeAnalysisOutputs(result.id, [{ key: `tbl:${tableIndex}`, ref: table }]),
      () => { onLoadFailure(); return [] as string[]; },
    );
    if (!ids.length) return;
    openWorksheet({ datasetId: ids[0] });
    onClose();
  });
  return { copy: inline.copyInlineTables, createFigure: inline.createStatisticalFigure, report, openTable };
}
