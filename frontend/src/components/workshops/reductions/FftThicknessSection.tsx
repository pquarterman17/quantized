// FFT film-thickness section — view. Pick a channel, set wavelength / range /
// window, run the FFT, show thickness ± uncertainty, and push the FFT
// magnitude spectrum to the library. Thin — logic lives in useFftThickness.

import { Button, DataTable, NumberField, Select } from "../../primitives";
import { fmtNum as fmt } from "../../../lib/format";
import { useFftThickness } from "./useFftThickness";

const WINDOWS = [
  { value: "hann", label: "Hann" },
  { value: "blackman", label: "Blackman" },
  { value: "none", label: "None" },
];

export default function FftThicknessSection() {
  const {
    active,
    columns,
    col,
    setCol,
    wavelength,
    setWavelength,
    twoThetaMin,
    twoThetaMax,
    setTwoThetaMin,
    setTwoThetaMax,
    windowFn,
    setWindowFn,
    maxThicknessNm,
    setMaxThicknessNm,
    result,
    busy,
    error,
    compute,
    toLibrary,
  } = useFftThickness();

  if (!active) {
    return (
      <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
        Select an XRD dataset (2θ vs intensity) first.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <label className="qzk-field-lbl">Intensity channel</label>
      <Select
        options={columns.map((c) => ({ value: String(c.index), label: c.label }))}
        value={String(col)}
        onChange={(e) => setCol(Number(e.target.value))}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto",
          gap: "6px 12px",
          marginTop: 10,
          alignItems: "center",
        }}
      >
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          Wavelength (Å)
        </label>
        <NumberField value={wavelength} width={88} step={0.0001} onChange={(v) => setWavelength(Number(v) || 0)} />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          2θ min
        </label>
        <NumberField
          value={twoThetaMin ?? ""}
          width={88}
          placeholder="auto"
          onChange={(v) => setTwoThetaMin(v.trim() === "" ? null : Number(v))}
        />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          2θ max
        </label>
        <NumberField
          value={twoThetaMax ?? ""}
          width={88}
          placeholder="auto"
          onChange={(v) => setTwoThetaMax(v.trim() === "" ? null : Number(v))}
        />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          Window
        </label>
        <Select options={WINDOWS} value={windowFn} onChange={(e) => setWindowFn(e.target.value)} />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          Max thickness (nm)
        </label>
        <NumberField value={maxThicknessNm} width={88} onChange={(v) => setMaxThicknessNm(Number(v) || 0)} />
      </div>

      <Button variant="primary" size="sm" style={{ marginTop: 12 }} disabled={busy} onClick={() => void compute()}>
        {busy ? "Computing…" : "Compute"}
      </Button>

      {error && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12 }}>
          <DataTable
            columns={["result", "value"]}
            rows={[
              ["Thickness", `${fmt(result.thickness_nm)} nm`],
              [
                "Uncertainty",
                result.uncertainty_nm == null ? "—" : `± ${fmt(result.uncertainty_nm)} nm`,
              ],
              ["Points used", String(result.n_points)],
            ]}
          />
          <Button size="sm" style={{ marginTop: 8 }} onClick={toLibrary}>
            → Library
          </Button>
        </div>
      )}
    </div>
  );
}
