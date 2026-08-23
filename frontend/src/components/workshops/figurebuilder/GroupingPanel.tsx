// Group-by binding for the canonical Publication Preview draft (F2.3h):
// which column splits the plotted series into one colored line per level --
// the field this app already renders and rejects invalid combinations for
// (`document.bindings.groupKey` -> `buildFigureSpecFromDocument`'s
// `group_col`), reachable everywhere EXCEPT here before this panel. Same
// "the panel was the only missing piece" shape as F2.3e/F2.3f.
//
// Vocabulary matches the Graph Builder's Group well (`GraphBuilderPanel.tsx`
// / `ZoneWell.tsx`): any column is a valid choice, including the one bound
// to X -- the well places no type/identity restriction on what can be
// dropped into Group, so this Select invents none either. "None" clears the
// binding, matching `StatStage.tsx`'s `facetByOptions`' "(none)" convention
// for an optional single-column pick.
//
// Setting a group on a draft that also plots a secondary Y axis is a real,
// backend-rejected combination (`figureSpec.ts`'s own check: "grouped
// figures cannot use a secondary Y axis"). This panel does not pre-block or
// warn about it locally -- the existing canonical-readiness banner
// (FigureBuilderView's `f.error`) already surfaces that failure with the
// exact reason, and duplicating the check here would just be a second,
// potentially stale copy of the one source of truth.
//
// Facet editing is deliberately NOT in THIS panel -- see useFigureBuilder.ts's
// `setGroupKey` doc for the full reasoning (F4.4, 2026-08-23, gave
// `document.bindings.facetKey` a real Stage render wire and creation
// surface -- `facetByColumn` -- neither of which reaches the Figure
// Builder/Publication Preview draft this panel edits; the F2.3d
// region-shades precedent).

import { Select } from "../../primitives";

export default function GroupingPanel({
  groupKey,
  labels,
  onGroupKey,
}: {
  /** The draft's group-by binding, or null for "no grouping" (every
   *  plotted channel renders as its own series, today's default). */
  groupKey: number | null;
  /** The bound dataset's raw channel labels, indexed by channel. */
  labels: readonly string[];
  onGroupKey: (next: number | null) => void;
}) {
  const options = [
    { value: "", label: "None" },
    ...labels.map((label, i) => ({ value: String(i), label })),
  ];
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <label className="qzk-field-lbl">group by</label>
      <Select
        aria-label="group by"
        style={{ maxWidth: 160, minWidth: 0 }}
        value={groupKey === null ? "" : String(groupKey)}
        onChange={(e) => onGroupKey(e.target.value === "" ? null : Number(e.target.value))}
        title="Split the plotted series into one colored line per level of this column"
        options={options}
      />
    </span>
  );
}
