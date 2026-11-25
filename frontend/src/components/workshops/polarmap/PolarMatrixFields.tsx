// Polar map: the matrix-worksheet input controls (rows = one angle, columns =
// the other). Axis values come from the data (X column / headers) or from a
// start and step. Logic and refusals live in polarMatrix.ts.

import { Select } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import type { MatrixAxisSource, MatrixRowsAre, PolarMatrixConfig } from "./polarMatrix";

interface Props {
  value: PolarMatrixConfig;
  onChange: (next: PolarMatrixConfig) => void;
}

function AxisFields({ label, dataLabel, src, onChange }: { label: string; dataLabel: string; src: MatrixAxisSource; onChange: (s: MatrixAxisSource) => void }) {
  return (
    <div style={{ minWidth: 150 }}>
      <label className="qzk-field-lbl">{label}</label>
      <Select
        aria-label={`${label} source`}
        options={[{ value: "data", label: dataLabel }, { value: "range", label: "Start and step" }]}
        value={src.from}
        onChange={(e) => onChange({ ...src, from: e.target.value as MatrixAxisSource["from"] })}
      />
      {src.from === "range" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 }}>
          <NumberField aria-label={`${label} start`} placeholder="start" value={src.start} onChange={(v) => onChange({ ...src, start: v })} />
          <NumberField aria-label={`${label} step`} placeholder="step" value={src.step} onChange={(v) => onChange({ ...src, step: v })} />
        </div>
      )}
    </div>
  );
}

export default function PolarMatrixFields({ value, onChange }: Props) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <div style={{ minWidth: 150 }}>
        <label className="qzk-field-lbl">Matrix rows are</label>
        <Select
          aria-label="Matrix rows are"
          options={[
            { value: "", label: "Choose…" },
            { value: "chi", label: "Tilt χ (columns = azimuth φ)" },
            { value: "phi", label: "Azimuth φ (columns = tilt χ)" },
          ]}
          value={value.rowsAre}
          onChange={(e) => onChange({ ...value, rowsAre: e.target.value as MatrixRowsAre })}
        />
      </div>
      <AxisFields label="Row angles" dataLabel="X column" src={value.rows} onChange={(rows) => onChange({ ...value, rows })} />
      <AxisFields label="Column angles" dataLabel="Column headers" src={value.cols} onChange={(cols) => onChange({ ...value, cols })} />
    </div>
  );
}
