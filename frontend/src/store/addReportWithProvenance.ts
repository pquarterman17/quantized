import type { ReportSheet } from "../lib/report";
import { stampReportTransformProvenance } from "../lib/reportTransformProvenance";
import { useApp } from "./useApp";

/** Feature-boundary report creation. Kept out of the eager store slice so the
 * provenance parser stays in the lazy analysis/report chunks that use it. */
export function addReportWithProvenance(
  name: string,
  report: ReportSheet,
  datasetId?: string | null,
): void {
  const state = useApp.getState();
  state.addReport(
    name,
    stampReportTransformProvenance(report, state.datasets, datasetId),
    datasetId,
  );
}
