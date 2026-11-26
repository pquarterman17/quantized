// The Stat Stage toolbar's half / split violin, paired, lollipop and stacked-
// histogram controls (plan item 20). Half / split: the style (a split needs a
// "then by" column with two levels) and the KDE bandwidth (shared with the
// ridgeline). Paired: the "before" (y) and "after" columns and the mean +- CI
// marker. Lollipop: the statistic and the order. Histogram: stack the columns.
// Split out of `StatStage.tsx` (400-line ceiling).

import type { ReactNode } from "react";

import { LOLLIPOP_SORTS, LOLLIPOP_STATS, RIDGE_BWS, VIOLIN_SIDES } from "../../lib/plotviewSanitize";
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

const SIDES = VIOLIN_SIDES.map((s) => ({ value: s, label: s }));
const STATS = LOLLIPOP_STATS.map((s) => ({ value: s, label: s }));
const SORTS = LOLLIPOP_SORTS.map((s) => ({ value: s, label: s === "none" ? "as is" : s === "asc" ? "ascending" : "descending" }));
const BWS = RIDGE_BWS.map((b) => ({ value: b, label: b === "scott" || b === "silverman" ? b : `factor ${b}` }));

export default function StatDist3Controls({ st }: { st: StatStageState }) {
  const d = st.dist2;
  if (st.mode === "histogram") {
    if (st.histCols.length === 0) return null;
    return (
      <Checkbox checked={d.histStack} onChange={(v) => st.setDist2({ histStack: v })} title="Stack the columns on the shared bins">
        stack
      </Checkbox>
    );
  }
  if (st.mode === "sideviolin") {
    return (
      <>
        <Picker label="side">
          <SegmentedControl options={SIDES} value={d.violinSide} onChange={(v) => st.setDist2({ violinSide: v })} />
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
    </>
  );
}
