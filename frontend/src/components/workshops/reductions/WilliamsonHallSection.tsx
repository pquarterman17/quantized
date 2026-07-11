// Williamson-Hall section — view. A manually-editable peak table (2θ, FWHM)
// plus instrument params (wavelength, K factor, instrumental broadening); the
// add/remove-row layout mirrors the reflectivity workshop's LayerTable. Thin —
// logic lives in useWilliamsonHall.

import { Button, DataTable, IconButton, NumberField } from "../../primitives";
import { fmtNum as fmt } from "../../../lib/format";
import { useWilliamsonHall } from "./useWilliamsonHall";

const ROW_COLS = "1fr 1fr 20px";

export default function WilliamsonHallSection() {
  const {
    rows,
    wavelength,
    kFactor,
    instrumentalBroadening,
    result,
    busy,
    error,
    canCompute,
    addRow,
    removeRow,
    updateRow,
    setWavelength,
    setKFactor,
    setInstrumentalBroadening,
    compute,
    clear,
  } = useWilliamsonHall();

  return (
    <div style={{ marginTop: 10 }}>
      <div className="qzk-ds-meta" style={{ display: "grid", gridTemplateColumns: ROW_COLS, gap: 6 }}>
        <span>2θ (°)</span>
        <span>FWHM (°)</span>
        <span />
      </div>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: ROW_COLS,
            gap: 6,
            marginTop: 4,
            alignItems: "center",
          }}
        >
          <NumberField value={row.twoTheta} width={90} onChange={(v) => updateRow(i, { twoTheta: Number(v) || 0 })} />
          <NumberField
            value={row.fwhm}
            width={90}
            step={0.001}
            onChange={(v) => updateRow(i, { fwhm: Number(v) || 0 })}
          />
          <IconButton title="Remove peak" disabled={rows.length <= 2} onClick={() => removeRow(i)}>
            ✕
          </IconButton>
        </div>
      ))}
      <Button size="sm" style={{ marginTop: 6 }} onClick={addRow}>
        + Add peak
      </Button>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto",
          gap: "6px 12px",
          marginTop: 12,
          alignItems: "center",
        }}
      >
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          Wavelength (Å)
        </label>
        <NumberField value={wavelength} width={88} step={0.0001} onChange={(v) => setWavelength(Number(v) || 0)} />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          K factor
        </label>
        <NumberField value={kFactor} width={88} step={0.01} onChange={(v) => setKFactor(Number(v) || 0)} />
        <label className="qzk-field-lbl" style={{ margin: 0 }}>
          Instrument broadening (°)
        </label>
        <NumberField
          value={instrumentalBroadening}
          width={88}
          step={0.001}
          onChange={(v) => setInstrumentalBroadening(Number(v) || 0)}
        />
      </div>

      <Button
        variant="primary"
        size="sm"
        style={{ marginTop: 12 }}
        disabled={busy || !canCompute}
        onClick={() => void compute()}
      >
        {busy ? "Fitting…" : "Fit"}
      </Button>

      {!canCompute && !error && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
          Enter at least 2 peaks (0 &lt; 2θ &lt; 180, FWHM &gt; 0).
        </div>
      )}
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
              [
                "Grain size",
                result.grain_size_nm == null
                  ? "undefined (intercept ≤ 0)"
                  : `${fmt(result.grain_size_nm)} nm`,
              ],
              ["Microstrain", fmt(result.microstrain)],
              ["R²", fmt(result.r2)],
            ]}
          />
          <Button size="sm" style={{ marginTop: 8 }} onClick={clear}>
            Clear result
          </Button>
        </div>
      )}
    </div>
  );
}
