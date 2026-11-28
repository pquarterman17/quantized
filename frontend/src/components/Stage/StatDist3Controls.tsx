// The Stat Stage toolbar's half / split violin, paired, lollipop and stacked-
// histogram controls (plan item 20). Half / split: the style (a split needs a
// "then by" column with two levels) and the KDE bandwidth (shared with the
// ridgeline). Paired: the "before" (y) and "after" columns and the mean +- CI
// marker. Lollipop: the statistic and the order. Histogram: stack the columns.
// Split out of `StatStage.tsx` (400-line ceiling).

import type { ReactNode } from "react";

import { LOLLIPOP_SORTS, LOLLIPOP_STATS, RIDGE_BWS, VIOLIN_MARKS, VIOLIN_SIDES } from "../../lib/plotviewSanitize";
import { Select } from "../primitives";
import { Checkbox } from "../primitives/Checkbox";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { pairedAfterCol } from "./statDist3Draw";
import type { StatStageState } from "./useStatStageTypes";

function Picker({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      {label}
      {children}
    </label>
  );
}

const SIDE_LABELS = { half: "right half", left: "left half", split: "split" };
const SIDES = VIOLIN_SIDES.map((s) => ({ value: s, label: SIDE_LABELS[s] }));
const MARKS = VIOLIN_MARKS.map((m) => ({ value: m, label: m === "none" ? "(none)" : m }));
const STATS = LOLLIPOP_STATS.map((s) => ({ value: s, label: s }));
const SORTS = LOLLIPOP_SORTS.map((s) => ({ value: s, label: s === "none" ? "as is" : s === "asc" ? "ascending" : "descending" }));
const BWS = RIDGE_BWS.map((b) => ({ value: b, label: b === "scott" || b === "silverman" ? b : `factor ${b}` }));

function Controls({ st }: { st: StatStageState }) {
  const d = st.dist2;
  if (st.mode === "histogram") {
    const split = d.histSplit && st.groupCol != null;
    const groupOptions = [{ value: "none", label: "(none)" }, ...st.categoricalCols.map((c) => ({ value: String(c.index), label: c.label }))];
    // Choosing a column splits the histogram into one stacked series per level; "(none)" is the plain histogram.
    const pick = (v: string) => {
      if (v === "none") return st.setDist2({ histSplit: false });
      st.setGroupCol(Number(v));
      st.setDist2({ histSplit: true, histStack: true });
    };
    return (
      <>
        {st.categoricalCols.length > 0 && (
          <Picker label="split by">
            <Select options={groupOptions} value={split ? String(st.groupCol) : "none"} onChange={(e) => pick(e.target.value)} />
          </Picker>
        )}
        {(st.histCols.length > 0 || split) && (
          <Checkbox checked={d.histStack} onChange={(v) => st.setDist2({ histStack: v })} title="Stack the series on the shared bins">
            stack
          </Checkbox>
        )}
      </>
    );
  }
  if (st.mode === "sideviolin") {
    return (
      <>
        <Picker label="side">
          <SegmentedControl options={SIDES} value={d.violinSide} onChange={(v) => st.setDist2({ violinSide: v })} />
        </Picker>
        <Picker label="inner marks">
          <Select options={MARKS} value={d.violinMarks} onChange={(e) => st.setDist2({ violinMarks: e.target.value as (typeof VIOLIN_MARKS)[number] })} />
        </Picker>
        <Picker label="bandwidth">
          <Select options={BWS} value={d.ridgeBw} onChange={(e) => st.setDist2({ ridgeBw: e.target.value as (typeof RIDGE_BWS)[number] })} />
        </Picker>
      </>
    );
  }
  if (st.mode === "lollipop") {
    return (
      <>
        <Picker label="value">
          <SegmentedControl options={STATS} value={d.lollipopStat} onChange={(v) => st.setDist2({ lollipopStat: v })} />
        </Picker>
        <Picker label="order">
          <Select options={SORTS} value={d.lollipopSort} onChange={(e) => st.setDist2({ lollipopSort: e.target.value as (typeof LOLLIPOP_SORTS)[number] })} />
        </Picker>
        <Checkbox checked={d.lollipopHoriz} onChange={(v) => st.setDist2({ lollipopHoriz: v })} title="Categories down the Y axis (a dot chart)">
          horizontal
        </Checkbox>
      </>
    );
  }
  if (st.mode !== "paired") return null;
  const channels = st.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const after = pairedAfterCol(st.histCols, st.valueCol, st.columns.length);
  return (
    <>
      <Picker label="before">
        <Select options={channels} value={String(st.valueCol)} onChange={(e) => st.setValueCol(Number(e.target.value))} />
      </Picker>
      <Picker label="after">
        <Select
          options={channels.filter((c) => c.value !== String(st.valueCol))}
          value={String(after)}
          onChange={(e) => st.setHistCols([Number(e.target.value)])}
        />
      </Picker>
      <Checkbox checked={d.pairedCi} onChange={(v) => st.setDist2({ pairedCi: v })} title="Each side's mean with its 95 % confidence interval">
        mean ± CI
      </Checkbox>
      <Checkbox checked={d.pairedDirection} onChange={(v) => st.setDist2({ pairedDirection: v })} title="Colour each line by increase, decrease or no change">
        by direction
      </Checkbox>
    </>
  );
}

/** The variants draw one panel of the whole sheet: a facet column picked for another plot is not applied to them (item 20).
 *  Said here rather than left as a plot that quietly ignores the pick. */
export function variantFacetNote(st: Pick<StatStageState, "mode" | "facetCol" | "dist2" | "groupCol">): string | null {
  if (st.facetCol == null) return null;
  const split = st.mode === "histogram" && st.dist2.histSplit && st.groupCol != null;
  return split || st.mode === "sideviolin" || st.mode === "lollipop" || st.mode === "paired"
    ? "This plot is not drawn per facet panel: the facet column is ignored here."
    : null;
}

export default function StatDist3Controls({ st }: { st: StatStageState }) {
  const note = variantFacetNote(st);
  return (
    <>
      <Controls st={st} />
      {note && <span role="note" style={{ fontSize: 11, color: "var(--text-faint)" }}>{note}</span>}
    </>
  );
}
