// The Stat Stage toolbar's marginal-plot and ridgeline controls (plan item 20).
// Marginal: Y is the stage's value column, X the first "extra column" (else the
// dataset's X column); what the strips draw; the bin rule for histogram strips; and the
// opt-in encodings: split the strips by a group, colour the points by a column, size them
// by a column. Ridgeline: the row overlap (any number), the KDE bandwidth (a rule or a free
// factor), the per-ridge scale and the facet picker (the group-by pickers are the categorical
// modes'). Split out of `StatStage.tsx` (400-line ceiling).

import type { ReactNode } from "react";

import { MARGINAL_KINDS } from "../../lib/plotviewSanitize";
import { Select } from "../primitives";
import BufferedNumberField from "../primitives/BufferedNumberField";
import { Checkbox } from "../primitives/Checkbox";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { marginalXCol } from "./statDist2Draw";
import BandwidthPicker from "./StatBandwidth";
import StatFacetPicker from "./StatFacetPicker";
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
const NONE = { value: "none", label: "(none)" };

function RidgelineControls({ st }: { st: StatStageState }) {
  const d = st.dist2;
  return (
    <>
      <Picker label="overlap">
        <BufferedNumberField
          value={d.ridgeOverlap} required min={0.05} max={5} width={56}
          onValue={(v) => v != null && st.setDist2({ ridgeOverlap: v })}
        />
      </Picker>
      <BandwidthPicker value={d.ridgeBw} onChange={(ridgeBw) => st.setDist2({ ridgeBw })} />
      <Checkbox checked={d.ridgeEach} onChange={(v) => st.setDist2({ ridgeEach: v })} title="Scale every ridge to its own peak, instead of one density scale for all">
        each to its peak
      </Checkbox>
      <StatFacetPicker st={st} />
    </>
  );
}

export default function StatDist2Controls({ st }: { st: StatStageState }) {
  if (st.mode === "ridgeline") return <RidgelineControls st={st} />;
  if (st.mode !== "marginal") return null;
  const channels = st.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const xCol = marginalXCol(st.histCols, st.columns.length);
  const d = st.dist2;
  const split = d.histSplit && st.groupCol != null;
  const numeric = [NONE, ...channels];
  const pickNumeric = (key: "marginalColor" | "marginalSize") => (e: { target: { value: string } }) =>
    st.setDist2({ [key]: e.target.value === "none" ? undefined : Number(e.target.value) });
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
        <SegmentedControl options={KINDS} value={d.marginal} onChange={(k) => st.setDist2({ marginal: k })} />
      </Picker>
      {d.marginal === "histogram" && (
        <Picker label="bins">
          <Select options={BIN_RULES.map((b) => ({ value: b, label: b }))} value={st.bins} onChange={(e) => st.setBins(e.target.value)} />
        </Picker>
      )}
      <Picker label="split by">
        <Select
          options={[NONE, ...st.categoricalCols.map((c) => ({ value: String(c.index), label: c.label }))]}
          value={split ? String(st.groupCol) : "none"}
          onChange={(e) => {
            const none = e.target.value === "none";
            if (!none) st.setGroupCol(Number(e.target.value));
            st.setDist2({ histSplit: !none });
          }}
        />
      </Picker>
      <Picker label="color">
        <Select options={numeric} value={d.marginalColor == null ? "none" : String(d.marginalColor)} onChange={pickNumeric("marginalColor")} />
      </Picker>
      <Picker label="size">
        <Select options={numeric} value={d.marginalSize == null ? "none" : String(d.marginalSize)} onChange={pickNumeric("marginalSize")} />
      </Picker>
    </>
  );
}
