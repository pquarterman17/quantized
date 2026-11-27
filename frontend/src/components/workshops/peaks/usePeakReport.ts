// Peaks workshop: "→ Report" (the fitted peak table as a report sheet in the
// library). Split out of PeaksPanel to keep the view under its ceiling.

import { useState } from "react";

import { reportEmit } from "../../../lib/api";
import type { MultiFitResult } from "../../../lib/types";
import type { Dataset } from "../../../lib/types";
import type { PeakTable } from "../../../lib/peakTable";
import { addReportWithProvenance } from "../../../store/addReportWithProvenance";
import { toast } from "../../../store/toasts";
import { peakReportResult, peakReportUnits } from "./peakReport";

type PlotView = Parameters<typeof peakReportUnits>[2];

export function usePeakReport(fitResult: MultiFitResult | null, active: Dataset | null, fitOutOfDate: boolean, peakTable: PeakTable | null | undefined, plotView: PlotView) {
  const [reporting, setReporting] = useState(false);
  const toReport = async () => {
    if (!fitResult || !active || fitOutOfDate) return;
    setReporting(true);
    try {
      const { report } = await reportEmit({
        kind: "multipeak_fit",
        // A published model-fit table's errors and objective ride along, so
        // the report says what the table shows (./peakReport).
        result: {
          ...peakReportResult(fitResult, peakTable, active.id),
          ...peakReportUnits(active, peakTable, plotView),
        },
        title: `Peak fit — ${active.name}`,
        source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
      });
      addReportWithProvenance(`Peak fit — ${active.name}`, report, active.id);
    } catch (e) {
      toast(`could not add to report — ${e instanceof Error ? e.message : "unknown error"}`, "danger");
    } finally {
      setReporting(false);
    }
  };
  return { reporting, toReport };
}
