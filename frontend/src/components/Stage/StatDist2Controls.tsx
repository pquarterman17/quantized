// The Stat Stage toolbar's marginal-plot and ridgeline controls (plan item 20).
// Marginal: Y is the stage's value column, X the first "extra column" (else the
// dataset's X column); what the strips draw; the bin rule for histogram strips.
// Ridgeline: the row overlap and the KDE bandwidth (the group-by pickers are the
// categorical modes'). Split out of `StatStage.tsx` (400-line ceiling).

import type { ReactNode } from "react";

import { MARGINAL_KINDS, RIDGE_BWS, RIDGE_OVERLAPS } from "../../lib/plotviewSanitize";
import { Select } from "../primitives";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { marginalXCol } from "./statDist2Draw";
import { BIN_RULES } from "./useStatStage";
import type { StatStageState } from "./useStatStageTypes";

function Picker({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      {label}
      {children}
    </label>
  );
}

const KINDS = MARGINAL_KINDS.map((k) => ({ value: k, label: k }));
const OVERLAPS = RIDGE_OVERLAPS.map((o) => ({ value: String(o), label: o < 1 ? `${o} (apart)` : o === 1 ? "1 (touching)" : `${o}` }));
const BWS = RIDGE_BWS.map((b) => ({ value: b, label: b === "scott" || b === "silverman" ? b : `factor ${b}` }));

export default function StatDist2Controls({ st }: { st: StatStageState }) {
  if (st.mode === "ridgeline") {
    return (
      <>
        <Picker label="overlap">
          <Select
            options={OVERLAPS} value={String(st.dist2.ridgeOverlap)}
            onChange={(e) => st.setDist2({ ridgeOverlap: Number(e.target.value) as (typeof RIDGE_OVERLAPS)[number] })}
          />
        </Picker>
        <Picker label="bandwidth">
          <Select
            options={BWS} value={st.dist2.ridgeBw}
            onChange={(e) => st.setDist2({ ridgeBw: e.target.value as (typeof RIDGE_BWS)[number] })}
          />
        </Picker>
      </>
    );
  }
  if (st.mode !== "marginal") return null;
  const channels = st.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const xCol = marginalXCol(st.histCols, st.columns.length);
  return (
    <>
      <Picker label="y">
        <Select options={channels} value={String(st.valueCol)} onChange={(e) => st.setValueCol(Number(e.target.value))} />
      </Picker>
      <Picker label="x">
        <Select
          options={[{ value: "-1", label: "(x column)" }, ...channels.filter((c) => c.value !== String(st.valueCol))]}
          value={String(xCol)}
          onChange={(e) => st.setHistCols(e.target.value === "-1" ? [] : [Number(e.target.value)])}
        />
      </Picker>
      <Picker label="margins">
        <SegmentedControl options={KINDS} value={st.dist2.marginal} onChange={(k) => st.setDist2({ marginal: k })} />
      </Picker>
      {st.dist2.marginal === "histogram" && (
        <Picker label="bins">
          <Select options={BIN_RULES.map((b) => ({ value: b, label: b }))} value={st.bins} onChange={(e) => st.setBins(e.target.value)} />
        </Picker>
      )}
    </>
  );
}
