// Preview-side readout for the Quick Figure Builder's Grouping and Label
// roles. The grouped split itself is drawn by the preview canvas; point
// labels are not (GraphPreview is the Graph Builder's shared mini-canvas), so
// their count and first few texts are stated here instead -- every accepted
// role change is visible before creation, and a blocked Label role names its
// reason (L0.36) under the id the Create button's aria-describedby points at.

import { levelCountOf } from "../../../lib/categorical";
import { quickFigurePointLabels } from "../../../lib/quickFigureLabels";
import type { QuickFigureMapping } from "../../../lib/quickFigureMapping";
import type { Dataset } from "../../../lib/types";

interface Props {
  dataset: Dataset;
  mapping: QuickFigureMapping;
  /** `pointLabelBlock(dataset, mapping)` -- computed once by the parent. */
  labelBlock: string | null;
}

export default function QuickRoleSummary({ dataset, mapping, labelBlock }: Props) {
  const { data } = dataset;
  const g = mapping.groupKey ?? null;
  const levels = g === null ? 0 : levelCountOf(data.values.map((row) => row[g]));
  const labels = mapping.labelKey == null || labelBlock ? [] : quickFigurePointLabels(dataset, mapping, "preview");
  const sample = labels.slice(0, 3).map((a) => a.text).join(", ");
  return (
    <>
      {g !== null && (
        <p className="qzk-quick-builder-preview-summary">
          {levels > 0
            ? `Grouped by "${data.labels[g]}": ${levels} level${levels === 1 ? "" : "s"} per Y series in the legend`
            : `"${data.labels[g]}" has no finite levels — the figure stays ungrouped`}
          {mapping.errorBindings.length > 0 ? ". Error bars are not drawn while a Group by column is set (they stay bound)." : ""}
        </p>
      )}
      {labelBlock && (
        <p id="quick-builder-label-warning" className="qzk-quick-builder-notice" role="status">{labelBlock}.</p>
      )}
      {labels.length > 0 && (
        <p className="qzk-quick-builder-preview-summary">
          {`${labels.length} point label${labels.length === 1 ? "" : "s"} from "${data.labels[mapping.labelKey!]}" (${sample}${labels.length > 3 ? ", …" : ""})`}
        </p>
      )}
    </>
  );
}
