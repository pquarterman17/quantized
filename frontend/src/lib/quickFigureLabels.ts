// Quick Figure Builder "Label" role (LIBRARY_WORKBOOK_UX_PLAN, Quick Figure
// Builder concept: X / Y / X error / Y error / label / grouping). A label
// column's per-row value becomes a text label on every plotted point.
//
// No new PlotView field: the labels are ordinary data-anchored `Annotation`s
// sharing one Object Manager `groupId` -- the SAME mechanism "Label peaks"
// (components/workshops/peaks/usePeaks.ts) already uses for point labels.
// They draw on the Stage (uplotOverlays' dot + text), reach publication export
// (figureSpec's annotation overrides), round-trip `.dwk` inside the figure
// document's own `plot.view.annotations`, and stay independently editable /
// bulk-selectable / deletable as one group afterwards. They are a creation-
// time snapshot: a later data edit does not re-flow them (same as Label peaks).
//
// Pure: never mutates the dataset. Rows the Stage hides (manual exclusion or
// a local filter -- `droppedRows`) get no label, and neither does a non-finite
// point or a blank label value, so no label ever floats with no point under it.

import { categoricalLevels, labelForCode } from "./categorical";
import type { QuickFigureMapping } from "./quickFigureMapping";
import { droppedRows } from "./rowstate";
import type { Annotation, Dataset } from "./types";

/** More labels than this is unreadable clutter and a heavy annotation list;
 *  the create gate refuses (with the count) rather than silently truncating. */
export const MAX_QUICK_POINT_LABELS = 500;

/** One annotation per (plotted Y, row) with a finite point and a non-blank
 *  label value. `limit` stops the scan early (the create gate only needs to
 *  know "zero" or "over the cap"). Empty when the mapping has no label role. */
export function quickFigurePointLabels(
  dataset: Dataset,
  mapping: QuickFigureMapping,
  groupId: string,
  limit = Infinity,
): Annotation[] {
  const labelKey = mapping.labelKey;
  const out: Annotation[] = [];
  if (labelKey == null) return out;
  const { time, values } = dataset.data;
  const levels = categoricalLevels(dataset.data, labelKey);
  const dropped = droppedRows(dataset);
  for (const yKey of mapping.yKeys) {
    for (let r = 0; r < values.length && out.length < limit; r++) {
      const row = values[r];
      const x = mapping.xKey === null ? time[r] : row[mapping.xKey];
      const y = row[yKey];
      const v = row[labelKey];
      if (dropped.has(r) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(v)) continue;
      const text = levels ? labelForCode(levels, v) : String(Number(v.toPrecision(6)));
      if (text?.trim()) out.push({ id: `${groupId}-${out.length}`, groupId, x, y, text });
    }
  }
  return out;
}
