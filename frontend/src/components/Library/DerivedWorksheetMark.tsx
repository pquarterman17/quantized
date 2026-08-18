// "This is a derived worksheet" marker (LIBRARY_WORKBOOK_UX_PLAN PR K,
// L0.50): a linked worksheet whose full table is produced by a pipeline
// from another dataset in the same workbook, distinct from an imported raw
// worksheet — L0.50 requires it "visibly identifies its source and
// correction pipeline". Its own file for the same reason RecomputedMark.tsx
// is: DatasetRow sits at the component ceiling.

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

export default function DerivedWorksheetMark({ dataset: d }: { dataset: Dataset }) {
  const sourceName = useApp((s) => s.datasets.find((x) => x.id === d.derivedFrom?.datasetId)?.name);
  if (!d.derivedFrom) return null;
  return (
    <span
      className="qzk-ds-meta"
      style={{ color: "var(--accent)" }}
      title={`Derived worksheet — source: ${sourceName ?? d.derivedFrom.datasetId}\npipeline: ${d.derivedFrom.pipeline}`}
    >
      ⇢
    </span>
  );
}
