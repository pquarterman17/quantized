// Spectroscopy extras workshop: the per-tool settings (view). Every numeric field
// commits on Enter/blur (BufferedNumberField); the hook validates before a run.

import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Select } from "../../primitives";
import type { SpectroExtrasState } from "./useSpectroExtras";

const row = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 } as const;

function Num({ label, value, min, max, step, onValue, hint, optional }: {
  label: string; value: number | null; min?: number; max?: number; step?: number | "any"; onValue: (v: number | null) => void; hint?: string; optional?: boolean;
}) {
  return (
    <div title={hint}>
      <label className="qzk-field-lbl">{label}</label>
      <BufferedNumberField aria-label={label} type="number" width={78} required={!optional} min={min} max={max} step={step ?? "any"}
        value={value ?? undefined} onValue={(v) => { if (v !== undefined || optional) onValue(v ?? null); }} />
    </div>
  );
}

function Pick<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div style={{ minWidth: 120 }}>
      <label className="qzk-field-lbl">{label}</label>
      <Select aria-label={label} options={options} value={value} onChange={(e) => onChange(e.target.value as T)} />
    </div>
  );
}

export default function SeForms({ t }: { t: SpectroExtrasState }) {
  const { opts, patch } = t;
  return (
    <div>
      {t.tab === "fsd" && (
        <>
          <div style={row}>
            <Num label="Line HWHM (X units)" value={opts.fsd.hwhm} min={0} onValue={(v) => patch("fsd", { hwhm: v ?? 1 })} hint="Half width at half maximum of the Lorentzian bands to remove" />
            <Num label="Enhancement K" value={opts.fsd.k} min={1} onValue={(v) => patch("fsd", { k: v ?? 1 })} hint="Every line comes out K times narrower than the assumed width; large K amplifies noise" />
            <Pick label="Apodization" value={opts.fsd.apodization} onChange={(v) => patch("fsd", { apodization: v })}
              options={[{ value: "triangular", label: "Triangular" }, { value: "bessel", label: "Bessel-type (1 - u²)²" }]} />
          </div>
          <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>Needs an evenly spaced X and no blanks. Narrower lines keep their position and area; apodization limits the noise gain.</div>
        </>
      )}
      {t.tab === "corr2d" && (
        <>
          <div style={row}>
            <div style={{ flex: 1, minWidth: 180 }} title="One value per ticked column, equally spaced; blank uses the column order">
              <label className="qzk-field-lbl">Perturbation values (optional)</label>
              <input aria-label="Perturbation values" className="qz-input" style={{ width: "100%" }} placeholder="e.g. 300, 310, 320, 330"
                value={opts.corr.perturbation} onChange={(e) => patch("corr", { perturbation: e.target.value })} />
            </div>
          </div>
          <div style={row}>
            <Num label="X min" optional value={opts.corr.xMin} onValue={(v) => patch("corr", { xMin: v })} hint="Crop the spectral axis (the map has one cell per X pair)" />
            <Num label="X max" optional value={opts.corr.xMax} onValue={(v) => patch("corr", { xMax: v })} />
          </div>
          <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>Each ticked column is one spectrum, in perturbation order (left to right). Mean-centred (dynamic) spectra; equally spaced perturbation is assumed.</div>
        </>
      )}
      {t.tab === "onset" && (
        <>
          <div style={row}>
            <Pick label="Baseline side" value={opts.onset.side} onChange={(v) => patch("onset", { side: v })}
              options={[{ value: "left", label: "Left (edge rises to the right)" }, { value: "right", label: "Right (mirror)" }]} />
            <Num label="Threshold fraction" value={opts.onset.fraction} min={0.001} max={0.999} onValue={(v) => patch("onset", { fraction: v ?? 0.1 })} hint="Onset = where the baseline-subtracted signal reaches this fraction of its extreme" />
            <Num label="Smoothing (rows)" value={opts.onset.smooth} min={1} step={2} onValue={(v) => patch("onset", { smooth: Math.round(v ?? 1) })} hint="1 = none, else an odd number of rows (Savitzky-Golay order 2)" />
          </div>
          <div style={row}>
            <Num label="Baseline from" optional value={opts.onset.baseMin} onValue={(v) => patch("onset", { baseMin: v })} hint="Blank: the outer 10 % of the window on the baseline side" />
            <Num label="Baseline to" optional value={opts.onset.baseMax} onValue={(v) => patch("onset", { baseMax: v })} />
            <Num label="Window from" optional value={opts.onset.xMin} onValue={(v) => patch("onset", { xMin: v })} hint="Blank: every row" />
            <Num label="Window to" optional value={opts.onset.xMax} onValue={(v) => patch("onset", { xMax: v })} />
          </div>
          <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>Both methods are reported: the baseline tangent meeting the steepest-slope tangent, and the threshold fraction.</div>
        </>
      )}
    </div>
  );
}
