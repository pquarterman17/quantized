import { reportEmit } from "../lib/api";
import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { addReportWithProvenance } from "./addReportWithProvenance";
import { useApp } from "./useApp";

interface DistributionReportRequest {
  sourceId: string;
  sourceName: string;
  sourceFingerprint: string;
  title: string;
  records: Record<string, unknown>[];
  /** Revalidates the workbench question after the asynchronous renderer lands. */
  accept: () => boolean;
}

/** Render and publish a Distribution report only while both its source data and
 * the workbench question that produced the records remain current. */
export async function publishDistributionReport(request: DistributionReportRequest): Promise<boolean> {
  const currentSource = () => useApp.getState().datasets.find((dataset) => dataset.id === request.sourceId);
  const sourceIsCurrent = () => {
    const source = currentSource();
    return !!source && !source.pending && analysisDataFingerprint(source) === request.sourceFingerprint;
  };
  if (!sourceIsCurrent() || !request.accept()) {
    useApp.getState().setStatus("the Distribution source or controls changed; report not added");
    return false;
  }
  const refs = [{ kind: "dataset" as const, id: request.sourceId, name: request.sourceName }];
  const { report } = await reportEmit({
    kind: "stats_table", records: request.records, title: request.title, source_refs: refs,
  });
  if (!sourceIsCurrent() || !request.accept()) {
    useApp.getState().setStatus("the Distribution source or controls changed; report not added");
    return false;
  }
  addReportWithProvenance(request.title, report, request.sourceId);
  useApp.getState().setStatus(`emitted ${request.title} report`);
  return true;
}
