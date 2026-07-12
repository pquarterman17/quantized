// Curve Fit — weighting control (Sol GUI audit: connect fitting to the plotted
// error columns). Compact: a mode selector + a column picker for `manual`, plus
// a non-fatal note when the chosen error column can't be used. State lives in
// useCurveFit; this is a thin view (workshop pattern, like BumpsSection).

import { Select } from "../../primitives";
import type { Dataset, WeightMode } from "../../../lib/types";

interface Props {
  active: Dataset | null;
  weightMode: WeightMode;
  setWeightMode: (m: WeightMode) => void;
  manualKey: number | null;
  setManualKey: (k: number | null) => void;
  /** Whether the primary fit channel has a designated error column. */
  hasYErr: boolean;
  weightNote: string | null;
}

export default function WeightingSection(p: Props) {
  const modeOptions: { value: WeightMode; label: string }[] = [
    { value: "none", label: "None (equal weights)" },
    { value: "yerr", label: p.hasYErr ? "Y error column" : "Y error column (none designated)" },
    { value: "poisson", label: "Poisson (√N)" },
    { value: "manual", label: "Manual error column" },
  ];
  const cols = p.active
    ? p.active.data.labels.map((lbl, i) => ({ value: String(i), label: lbl }))
    : [];

  return (
    <div style={{ marginTop: 10 }}>
      <label className="qzk-field-lbl">Weighting</label>
      <Select
        options={modeOptions.map((o) => ({ value: o.value, label: o.label }))}
        value={p.weightMode}
        disabled={!p.active}
        onChange={(e) => p.setWeightMode(e.target.value as WeightMode)}
      />
      {p.weightMode === "manual" && (
        <Select
          options={[{ value: "", label: "— pick error column —" }, ...cols]}
          value={p.manualKey == null ? "" : String(p.manualKey)}
          disabled={!p.active}
          onChange={(e) => p.setManualKey(e.target.value === "" ? null : Number(e.target.value))}
        />
      )}
      {p.weightNote && (
        <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--warning)" }}>
          {p.weightNote}
        </div>
      )}
    </div>
  );
}
