// "This is a derived worksheet" marker (LIBRARY_WORKBOOK_UX_PLAN PR K,
// L0.50): a linked worksheet whose full table is produced by a pipeline
// from another dataset in the same workbook, distinct from an imported raw
// worksheet — L0.50 requires it "visibly identifies its source and
// correction pipeline". Its own file for the same reason RecomputedMark.tsx
// is: DatasetRow sits at the component ceiling.
//
// P2.2 slice 3: a reflectivity FIT CURVE is derived too and gets the same
// mark, read from its `metadata.reflFit` provenance (source ids + the fit's
// number) — deliberately NOT `derivedFrom`, which would put it in the recalc
// graph, whose executor would overwrite the fitted curve with its source's
// corrected data. Lazy like the rest of the row (plans/BUNDLE_HEADROOM.md
// slice 6), so this costs the eager bundle nothing.

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

/** Where a dataset was derived from, or null for an ordinary one. Tolerant
 *  of a hand-edited `metadata.reflFit`: anything but a source-id string
 *  reads as "not derived" rather than throwing in the Library row. */
export function derivedSource(d: Dataset): { datasetId: string; pipeline: string } | null {
  if (d.derivedFrom) return d.derivedFrom;
  const fit = d.data.metadata?.reflFit as { sourceIds?: unknown; seq?: unknown } | undefined;
  const id = Array.isArray(fit?.sourceIds) ? fit.sourceIds[0] : undefined;
  return typeof id === "string" ? { datasetId: id, pipeline: `reflectivity fit #${String(fit?.seq ?? "?")}` } : null;
}

export default function DerivedWorksheetMark({ dataset: d }: { dataset: Dataset }) {
  const from = derivedSource(d);
  const sourceName = useApp((s) => s.datasets.find((x) => x.id === from?.datasetId)?.name);
  if (!from) return null;
  return (
    <span
      className="qzk-ds-meta"
      style={{ color: "var(--accent)" }}
      title={`Derived worksheet — source: ${sourceName ?? from.datasetId}\npipeline: ${from.pipeline}`}
    >
      ⇢
    </span>
  );
}
