// Reflectivity FFT section — view. Kiessig-fringe thickness(es) + MATLAB's
// superlattice harmonic analysis. XRR (2θ) needs a wavelength; NR (Q) does
// not. "→ Library" pushes the FFT magnitude spectrum as a new dataset. Thin —
// logic lives in useReflectivityFft.

import { Button, Checkbox, DataTable, NumberField, Select } from "../../primitives";
import { fmtNum as fmt } from "../../../lib/format";
import { type ReflFftPreprocess, useReflectivityFft } from "./useReflectivityFft";

const WINDOWS = [
  { value: "hann", label: "Hann" },
  { value: "blackman", label: "Blackman" },
  { value: "none", label: "None" },
];
const PREPROCESS = [
  { value: "logR", label: "log R" },
  { value: "logRQ4", label: "log(R·Q⁴)" },
  { value: "R", label: "R" },
  { value: "RQ4", label: "R·Q⁴" },
];

export default function ReflectivityFftSection() {
  const {
    active,
    columns,
    col,
    setCol,
    isNeutron,
    setIsNeutron,
    wavelength,
    setWavelength,
    xMin,
    xMax,
    setXMin,
    setXMax,
    windowFn,
    setWindowFn,
    preprocess,
    setPreprocess,
    maxThicknessNm,
    setMaxThicknessNm,
    peakProminence,
    setPeakProminence,
    result,
    busy,
    error,
    compute,
    toLibrary,
  } = useReflectivityFft();

  if (!active) {
    return (
      <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
        Select a reflectivity dataset (x vs R) first.
      </div>
    );
  }

  const sl = result?.superlattice;

  return (
    <div style={{ marginTop: 10 }}>
      <label className="qzk-field-lbl">Reflectivity channel</label>
      <Select
        options={columns.map((c) => ({ value: String(c.index), label: c.label }))}
        value={String(col)}
        onChange={(e) => setCol(Number(e.target.value))}
      />

      <div style={{ marginTop: 8 }}>
        <Checkbox checked={isNeutron} onChange={setIsNeutron}>
          Neutron (x is Q, Å⁻¹)
        </Checkbox>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto",
          gap: "6px 12px",
          marginTop: 10,
          alignItems: "center",
        }}
      >
        {!isNeutron && (
          <>
            <label className="qzk-field-lbl" style={{ margin: 0 }}>
              Wavelength (Å)
            </label>
            <NumberField
              value={wavelength}
              width={88}
              step={0.0001}
              onChange={(v) => setWavelength(Number(v) || 0)}
            />
          </>
        )}
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          {isNeutron ? "Q min" : "2θ min"}
        </label>
        <NumberField
          value={xMin ?? ""}
          width={88}
          placeholder="auto"
          onChange={(v) => setXMin(v.trim() === "" ? null : Number(v))}
        />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          {isNeutron ? "Q max" : "2θ max"}
        </label>
        <NumberField
          value={xMax ?? ""}
          width={88}
          placeholder="auto"
          onChange={(v) => setXMax(v.trim() === "" ? null : Number(v))}
        />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          Preprocess
        </label>
        <Select
          options={PREPROCESS}
          value={preprocess}
          onChange={(e) => setPreprocess(e.target.value as ReflFftPreprocess)}
        />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          Window
        </label>
        <Select options={WINDOWS} value={windowFn} onChange={(e) => setWindowFn(e.target.value)} />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          Max thickness (nm)
        </label>
        <NumberField value={maxThicknessNm} width={88} onChange={(v) => setMaxThicknessNm(Number(v) || 0)} />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          Peak prominence
        </label>
        <NumberField
          value={peakProminence}
          width={88}
          step={0.01}
          onChange={(v) => setPeakProminence(Number(v) || 0)}
        />
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
            columns={["thickness (nm)", "amplitude", "label"]}
            rows={result.thicknesses_nm.map((t, i) => [
              fmt(t),
              fmt(result.amplitudes[i]),
              result.harmonic_labels[i] || "—",
            ])}
          />
          {sl?.detected && (
            <div className="qzk-ds-meta" style={{ marginTop: 8 }}>
              Superlattice: Λ = {fmt(sl.bilayer_period_nm)} nm · {fmt(sl.n_repeats)} repeats · total{" "}
              {fmt(sl.total_thickness_nm)} nm
              {sl.suppressed_orders.length > 0 && ` · suppressed orders ${sl.suppressed_orders.join(", ")}`}
            </div>
          )}
          <Button size="sm" style={{ marginTop: 8 }} onClick={toLibrary}>
            → Library
          </Button>
        </div>
      )}
    </div>
  );
}
