// Time series workshop: the per-tool settings (view). Every numeric field commits
// on Enter/blur (BufferedNumberField); the hook validates before a run.

import { Checkbox } from "../../primitives/Checkbox";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Select } from "../../primitives";
import type { TimeSeriesState } from "./useTimeSeries";

const row = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 } as const;

function Num({ label, value, min, max, step, onValue, hint }: {
  label: string; value: number; min?: number; max?: number; step?: number | "any"; onValue: (v: number) => void; hint?: string;
}) {
  return (
    <div title={hint}>
      <label className="qzk-field-lbl">{label}</label>
      <BufferedNumberField aria-label={label} type="number" width={72} required min={min} max={max} step={step ?? "any"}
        value={value} onValue={(v) => { if (v !== undefined) onValue(v); }} />
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

export default function TsForms({ t }: { t: TimeSeriesState }) {
  const { opts, patch } = t;
  return (
    <div>
      {t.tab === "correlogram" && (
        <div style={row}>
          <Num label="Lags (0 = auto)" value={opts.corr.nlags} min={0} step={1} onValue={(v) => patch("corr", { nlags: Math.round(v) })} />
          <Num label="Alpha" value={opts.corr.alpha} min={0.001} max={0.5} onValue={(v) => patch("corr", { alpha: v })} hint="Confidence level of the bands is 1 - alpha" />
        </div>
      )}
      {t.tab === "stationarity" && (
        <div style={row}>
          <Pick label="Tests" value={opts.stat.tests} onChange={(v) => patch("stat", { tests: v })}
            options={[{ value: "both", label: "ADF and KPSS" }, { value: "adf", label: "ADF only" }, { value: "kpss", label: "KPSS only" }]} />
          <Pick label="Deterministic part" value={opts.stat.regression} onChange={(v) => patch("stat", { regression: v })}
            options={[{ value: "c", label: "Constant (level)" }, { value: "ct", label: "Constant + trend" }]} />
          <Num label="Alpha" value={opts.stat.alpha} min={0.001} max={0.5} onValue={(v) => patch("stat", { alpha: v })} />
        </div>
      )}
      {t.tab === "decompose" && (
        <div style={row}>
          <Num label="Period (samples)" value={opts.decomp.period} min={2} step={1} onValue={(v) => patch("decomp", { period: Math.round(v) })}
            hint="Samples in one cycle (for example 24 for hourly data with a daily cycle)" />
          <Pick label="Model" value={opts.decomp.model} onChange={(v) => patch("decomp", { model: v })}
            options={[{ value: "additive", label: "Additive (T + S + R)" }, { value: "multiplicative", label: "Multiplicative (T x S x R)" }]} />
        </div>
      )}
      {t.tab === "changepoint" && (
        <>
          <div style={row}>
            <Pick label="Method" value={opts.cp.method} onChange={(v) => patch("cp", { method: v, maxChanges: 0 })}
              options={[{ value: "pelt", label: "PELT (exact)" }, { value: "binseg", label: "Binary segmentation" }]} />
            <Pick label="Change in" value={opts.cp.cost} onChange={(v) => patch("cp", { cost: v })}
              options={[{ value: "mean", label: "Mean" }, { value: "var", label: "Variance" }, { value: "meanvar", label: "Mean and variance" }]} />
            <Pick label="Penalty" value={opts.cp.penalty} onChange={(v) => patch("cp", { penalty: v })}
              options={[{ value: "mbic", label: "Modified BIC" }, { value: "bic", label: "BIC" }, { value: "aic", label: "AIC" }, { value: "value", label: "Value" }]} />
          </div>
          <div style={row}>
            {opts.cp.penalty === "value" && <Num label="Penalty value" value={opts.cp.penaltyValue} min={0} onValue={(v) => patch("cp", { penaltyValue: v })} hint="Cost a change must save to be kept; larger means fewer changes" />}
            <Num label="Min segment" value={opts.cp.minSize} min={2} step={1} onValue={(v) => patch("cp", { minSize: Math.round(v) })} />
            {opts.cp.method === "binseg" && <Num label="Max changes (0 = no limit)" value={opts.cp.maxChanges} min={0} step={1} onValue={(v) => patch("cp", { maxChanges: Math.round(v) })} />}
          </div>
        </>
      )}
      {t.tab === "arima" && (
        <>
          <div style={row}>
            <Num label="p (AR)" value={opts.arima.p} min={0} max={5} step={1} onValue={(v) => patch("arima", { p: Math.round(v) })} />
            <Num label="d (differences)" value={opts.arima.d} min={0} max={2} step={1} onValue={(v) => patch("arima", { d: Math.round(v) })} />
            <Num label="q (MA)" value={opts.arima.q} min={0} max={5} step={1} onValue={(v) => patch("arima", { q: Math.round(v) })} />
          </div>
          <div style={row}>
            <Pick label="Constant" value={opts.arima.trend} onChange={(v) => patch("arima", { trend: v })}
              options={[{ value: "auto", label: "Automatic (d = 0 only)" }, { value: "c", label: "Include (d = 0)" }, { value: "n", label: "None" }]} />
            <Num label="Forecast steps" value={opts.arima.steps} min={0} step={1} onValue={(v) => patch("arima", { steps: Math.round(v) })} />
            <Num label="Alpha" value={opts.arima.alpha} min={0.001} max={0.5} onValue={(v) => patch("arima", { alpha: v })} />
          </div>
        </>
      )}
      <div style={{ marginTop: 8 }}>
        <Checkbox checked={opts.allowIrregular} onChange={(v) => patch("allowIrregular", v)}
          title="By default an unevenly spaced X is refused; tick to treat the points as equally spaced anyway (the result is then approximate)">
          Allow uneven spacing
        </Checkbox>
      </div>
    </div>
  );
}
