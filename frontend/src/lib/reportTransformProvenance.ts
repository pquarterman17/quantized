import type { ReportSheet } from "./report";
import {
  sanitizeTransformProvenance,
  transformProvenanceOfDataset,
  type TransformProvenance,
} from "./transformProvenance";
import type { Dataset } from "./types";

export const REPORT_TRANSFORM_PROVENANCE_KEY = "quantized_transform_recipes";
export const REPORT_TRANSFORM_PROVENANCE_TRUNCATED_KEY = "quantized_transform_recipes_truncated";
const MAX_REPORT_TRANSFORMS = 64;

function key(provenance: TransformProvenance): string {
  // Two applications of the same recipe/revision can use different bindings
  // (or be separate runs at different times). Collapse only an exact
  // provenance duplicate, never merely a same-name recipe.
  return JSON.stringify(provenance);
}

function unique(items: readonly TransformProvenance[]): TransformProvenance[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Durable provenance snapshots already stored on a report. */
export function reportTransformProvenance(report: ReportSheet): TransformProvenance[] {
  const raw = report.meta?.[REPORT_TRANSFORM_PROVENANCE_KEY];
  // Project/report metadata is an input boundary. Bound work before parsing,
  // not only the returned list: a hostile or corrupted report must not make
  // opening the Report panel walk an arbitrarily large array.
  return unique(Array.isArray(raw) ? raw.slice(0, MAX_REPORT_TRANSFORMS).flatMap((item) => {
    const provenance = sanitizeTransformProvenance(item);
    return provenance ? [provenance] : [];
  }) : []).slice(0, MAX_REPORT_TRANSFORMS);
}

export function reportTransformProvenanceWasTruncated(report: ReportSheet): boolean {
  return report.meta?.[REPORT_TRANSFORM_PROVENANCE_TRUNCATED_KEY] === true;
}

/** Stamp every transformed dataset referenced by a report. The snapshot is
 * additive and detached: later edits/deletion of the source worksheet cannot
 * silently rewrite what the report says it was computed from. */
export function stampReportTransformProvenance(
  report: ReportSheet,
  datasets: readonly Dataset[],
  fallbackDatasetId?: string | null,
): ReportSheet {
  const ids = new Set(
    (report.source_refs ?? [])
      .filter((ref) => ref.kind === "dataset")
      .map((ref) => ref.id),
  );
  if (fallbackDatasetId) ids.add(fallbackDatasetId);
  const live = datasets.flatMap((dataset) => {
    if (!ids.has(dataset.id)) return [];
    const provenance = transformProvenanceOfDataset(dataset);
    return provenance ? [provenance] : [];
  });
  const all = unique([...reportTransformProvenance(report), ...live]);
  const provenance = all.slice(0, MAX_REPORT_TRANSFORMS);
  if (provenance.length === 0) return report;
  const rawStored = report.meta?.[REPORT_TRANSFORM_PROVENANCE_KEY];
  const truncated = all.length > MAX_REPORT_TRANSFORMS ||
    (Array.isArray(rawStored) && rawStored.length > MAX_REPORT_TRANSFORMS) ||
    reportTransformProvenanceWasTruncated(report);
  return {
    ...report,
    meta: {
      ...report.meta,
      [REPORT_TRANSFORM_PROVENANCE_KEY]: structuredClone(provenance),
      ...(truncated ? { [REPORT_TRANSFORM_PROVENANCE_TRUNCATED_KEY]: true } : {}),
    },
  };
}
