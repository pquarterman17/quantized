// The Stat Stage toolbar's one-sample controls: the column picker and options
// of Q-Q, Histogram and CDF (plan item 20), plus the rug option the histogram
// and CDF share. Split out of `StatStage.tsx` (400-line ceiling); behaviour of
// the Q-Q and histogram controls is unchanged.

import type { ReactNode } from "react";

import { RUG_LENGTH, RUG_OPACITY } from "../../lib/statCdf";
import type { CdfY } from "../../lib/statCdf";
import { Select } from "../primitives";
import { Checkbox } from "../primitives/Checkbox";
import { SegmentedControl } from "../primitives/SegmentedControl";
import HistColumnsPicker from "./HistColumnsPicker";
import { BIN_RULES, DISTRIBUTIONS } from "./useStatStage";
import type { StatStageState } from "./useStatStageTypes";

const CDF_Y: { value: CdfY; label: string }[] = [
  { value: "proportion", label: "Proportion" },
  { value: "count", label: "Count" },
];

function Picker({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      {label}
      {children}
    </label>
  );
}

function RugControls({ st }: { st: StatStageState }) {
  const on = !!st.rug?.on;
  const slider = (label: string, key: "length" | "opacity", r: { min: number; max: number; default: number }) => (
    <Picker label={label}>
      <input
        type="range" aria-label={`rug ${label}`} min={r.min} max={r.max} step={0.01} style={{ width: 70 }}
        value={st.rug?.[key] ?? r.default} onChange={(e) => st.setRug({ [key]: Number(e.target.value) })}
      />
    </Picker>
  );
  return (
    <>
      <Checkbox checked={on} onChange={(v) => st.setRug({ on: v })} title="A short tick for every data value along the X axis">
        rug
      </Checkbox>
      {on && slider("length", "length", RUG_LENGTH)}
      {on && slider("opacity", "opacity", RUG_OPACITY)}
    </>
  );
}

export default function StatDistControls({ st }: { st: StatStageState }) {
  const { mode } = st;
  if (mode !== "qq" && mode !== "histogram" && mode !== "cdf") return null;
  const columnOptions = st.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const fitPicker = (
    <Picker label="fit">
      <Select
        options={[{ value: "none", label: "none" }, ...DISTRIBUTIONS.map((d) => ({ value: d, label: d }))]}
        value={st.fit ?? "none"}
        onChange={(e) => st.setFit(e.target.value === "none" ? null : e.target.value)}
      />
    </Picker>
  );
  const columns = <HistColumnsPicker columns={st.columns} valueCol={st.valueCol} picked={st.histCols} onChange={st.setHistCols} />;
  return (
    <>
      <Picker label="column">
        <Select options={columnOptions} value={String(st.valueCol)} onChange={(e) => st.setValueCol(Number(e.target.value))} />
      </Picker>
      {mode === "qq" && (
        <Picker label="dist">
          <Select
            options={DISTRIBUTIONS.map((d) => ({ value: d, label: d }))}
            value={st.dist}
            onChange={(e) => st.setDist(e.target.value)}
          />
        </Picker>
      )}
      {mode === "histogram" && (
        <>
          <Picker label="bins">
            <Select options={BIN_RULES.map((b) => ({ value: b, label: b }))} value={st.bins} onChange={(e) => st.setBins(e.target.value)} />
          </Picker>
          {columns}
          {fitPicker}
        </>
      )}
      {mode === "cdf" && (
        <>
          <Picker label="y">
            <SegmentedControl options={CDF_Y} value={st.cdfY} onChange={st.setCdfY} />
          </Picker>
          {columns}
          {fitPicker}
          <Checkbox checked={st.cdfBand} onChange={st.setCdfBand} title="95 % Dvoretzky-Kiefer-Wolfowitz confidence band">
            band
          </Checkbox>
        </>
      )}
      {mode !== "qq" && <RugControls st={st} />}
    </>
  );
}
