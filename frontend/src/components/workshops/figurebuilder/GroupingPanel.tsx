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
// Setting a group on a draft that also plots a secondary Y axis is a real
// combination, but not a refused one (BUG-013 round 5): the canvas has
// always degraded it to a plain, ungrouped overlay
// (`plotGroupSplit.canvasGroupCol`), and the export wire now matches that
// exactly instead of refusing a figure the screen already renders. This
// panel invents no local warning for it -- the one source of truth for the
// degrade lives in `plotGroupSplit.canvasGroupCol` (`figureSpec.ts` calls it
// directly; the one-line `figureSpecGroup.resolveGroupCol` alias that used
// to sit between them was deleted, round-5-review NIT 9), and duplicating
// it here would just be a second, potentially stale copy.
//
// Facet editing joined this panel once F4.4 made `bindings.facetKey` a real
// screen/export wire and the canonical preview learned to render faceted
// documents. The binding remains separate from Group: facets create panels,
// while groups split series within each panel.

import { Select } from "../../primitives";

export default function GroupingPanel({
  groupKey,
  facetKey,
  labels,
  onGroupKey,
  onFacetKey,
}: {
  /** The draft's group-by binding, or null for "no grouping" (every
   *  plotted channel renders as its own series, today's default). */
  groupKey: number | null;
  /** The draft's facet-by binding, or null for a single plot. */
  facetKey: number | null;
  /** The bound dataset's raw channel labels, indexed by channel. */
  labels: readonly string[];
  onGroupKey: (next: number | null) => void;
  onFacetKey: (next: number | null) => void;
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
        title="Split the plotted series into one colored line per level of this column. Drawn as a plain, ungrouped overlay instead — on screen and in export — whenever a secondary Y axis is also bound."
        options={options}
      />
      <label className="qzk-field-lbl" style={{ marginTop: 4 }}>facet by</label>
      <Select
        aria-label="facet by"
        style={{ maxWidth: 160, minWidth: 0 }}
        value={facetKey === null ? "" : String(facetKey)}
        onChange={(e) => onFacetKey(e.target.value === "" ? null : Number(e.target.value))}
        title="Split the figure into one panel per level of this column."
        options={options}
      />
    </span>
  );
}
