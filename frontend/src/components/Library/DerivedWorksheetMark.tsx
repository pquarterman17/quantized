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
// corrected data. A SIMS-processed profile (`metadata.sims_source`, P2.3)
// is marked the same way. Lazy like the rest of the row (plans/BUNDLE_HEADROOM.md
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
  if (typeof id === "string") return { datasetId: id, pipeline: `reflectivity fit #${String(fit?.seq ?? "?")}` };
  // P2.3: a SIMS-processed profile (lib/transformSims.ts) — same reasoning
  // as the fit curve: provenance only, never the recalc graph. `sims_source`
  // is carried in `metadata`, which every later transform (resample, stack,
  // ...) spreads forward from its own input — so a sims -> resample chain's
  // OUTPUT would otherwise still read `sims_source` and get mis-marked as
  // itself the direct SIMS output of the ORIGINAL raw profile (2026-09
  // review finding 4). `worksheet_transform` is always overwritten to the
  // op that most recently produced THIS dataset (`lib/transformWarnings.ts`'s
  // `stampWarnings`, run on every commit) — checking it here is how the mark
  // reads the provenance as being for THIS dataset, not merely present.
  const sims = d.data.metadata?.sims_source as { id?: unknown } | undefined;
  return typeof sims?.id === "string" && d.data.metadata?.worksheet_transform === "sims"
    ? { datasetId: sims.id, pipeline: "SIMS processing" }
    : null;
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
