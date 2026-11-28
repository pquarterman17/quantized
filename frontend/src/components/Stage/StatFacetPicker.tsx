// The "facet by" picker: small multiples, one panel per level of a SECOND categorical column.
// Shared by the Stat Stage toolbar (box, violin, strip, bar, half / split violin, lollipop) and the
// paired and split-histogram controls, so every mode that draws panels offers the pick.

import type { StatStageState } from "./useStatStageTypes";
import { Select } from "../primitives";

export default function StatFacetPicker({ st }: { st: Pick<StatStageState, "categoricalCols" | "facetCol" | "groupCol" | "group2Col" | "setFacetCol"> }) {
  // #11: small multiples for Box/Violin/Strip/Bar — one panel per level of a
  // SECOND categorical column (independent of "group by"). Both the
  // "group by" and "then by" columns are omitted for the same reason
  // `thenByOptions` omits "group by" above: faceting by the column already
  // used as "group by" puts exactly one level in every panel (one box per
  // panel — the grouping and the faceting collapse onto the same split), and
  // faceting by "then by" makes every box in a panel share the same constant
  // nested half. Both are degenerate, not wrong — the data is still correct,
  // the plot is just noise. (`maskStaleCategoricalPicks` deliberately does
  // NOT mirror this at the value layer: `facetCol` has another entry point —
  // the Graph Builder seed, which sets it from `spec.zones.facet?.channel`
  // with no categorical gate — and faceting on a non-categorical column is a
  // supported configuration there. Masking `facetCol` was already tried and
  // reverted as a regression; see lib/statstage.ts. This list only stops the
  // user from asking for the degenerate case through THIS picker — a value
  // that arrives another way, or that "group by" moves onto afterwards, is
  // left alone because the data stays correct either way.)
  //
  // WHICH IS EXACTLY WHY the filter spares the CURRENT `facetCol`, degenerate
  // or not: `st.facetCol` is the RAW state (`effectiveFacetCol`), unlike
  // `st.group2Col`, which `maskStaleCategoricalPicks` nulls whenever it
  // collides with "group by" — so `thenByOptions` can never omit its own
  // value and this list could. It did: with "group by" moved onto the faceted
  // column, the stage kept drawing one panel per level while this `<select>`
  // read "(none)", and since "(none)" was already `selectedIndex` 0 choosing
  // it fired no `change` event — `setFacetCol(null)` was unreachable and the
  // facet could not be cleared from its own picker. A degenerate combination
  // is worth not OFFERING; it is never worth misreporting the live state.
  // Narrow claim, and the narrowness is pre-existing: this list is built from
  // `categoricalCols`, so a `facetCol` the Graph Builder seeded onto a
  // NON-categorical column still has no option of its own and still reads
  // "(none)". That predates this filter and is unchanged by it — what the
  // filter guarantees is that a facet column this picker could have offered is
  // always the value it displays.
  const options = [
    { value: "none", label: "(none)" },
    ...st.categoricalCols
      .filter(
        (c) => c.index === st.facetCol || (c.index !== st.groupCol && c.index !== st.group2Col),
      )
      .map((c) => ({ value: String(c.index), label: c.label })),
  ];
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      facet by
      <Select
        options={options}
        value={st.facetCol == null ? "none" : String(st.facetCol)}
        onChange={(e) => st.setFacetCol(e.target.value === "none" ? null : Number(e.target.value))}
      />
    </label>
  );
}
