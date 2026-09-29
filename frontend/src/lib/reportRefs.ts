// The one piece of lib/report.ts the entry chunk needs: dataset removal
// (store/removeDatasets.ts) nulls a removed dataset out of report
// back-references synchronously. Split out as a leaf (bundle diet slice 12,
// plans/BUNDLE_HEADROOM.md) so the report validators — reached only from the
// lazy `.dwk` codec — no longer ride in the entry chunk behind this one
// helper. lib/report.ts re-exports it, so its other importers are unchanged.

import type { ReportEntry } from "./report";

/** Null a removed dataset out of the entries' back-references (keep the
 *  reports themselves — they are computed artifacts, not views). */
export function pruneReportRefs(
  reports: ReportEntry[],
  removedIds: ReadonlySet<string>,
): ReportEntry[] {
  return reports.map((r) =>
    r.datasetId && removedIds.has(r.datasetId) ? { ...r, datasetId: null } : r,
  );
}
