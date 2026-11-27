// Time series workshop: the per-tool settings (view). Every numeric field commits
// on Enter/blur (BufferedNumberField); the hook validates before a run.

import { Checkbox } from "../../primitives/Checkbox";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Select } from "../../primitives";
import { ARIMA_TREND_OPTIONS, CP_COST_OPTIONS, CP_METHOD_OPTIONS, CP_PENALTY_OPTIONS, DECOMP_MODEL_OPTIONS, STAT_REGRESSION_OPTIONS, STAT_TESTS_OPTIONS } from "./timeSeriesOptions";
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
            options={STAT_TESTS_OPTIONS} />
          <Pick label="Deterministic part" value={opts.stat.regression} onChange={(v) => patch("stat", { regression: v })}
            options={STAT_REGRESSION_OPTIONS} />
          <Num label="Alpha" value={opts.stat.alpha} min={0.001} max={0.5} onValue={(v) => patch("stat", { alpha: v })} />
        </div>
      )}
      {t.tab === "decompose" && (
        <div style={row}>
          <Num label="Period (samples)" value={opts.decomp.period} min={2} step={1} onValue={(v) => patch("decomp", { period: Math.round(v) })}
            hint="Samples in one cycle (for example 24 for hourly data with a daily cycle)" />
          <Pick label="Model" value={opts.decomp.model} onChange={(v) => patch("decomp", { model: v })}
            options={DECOMP_MODEL_OPTIONS} />
        </div>
      )}
      {t.tab === "changepoint" && (
        <>
          <div style={row}>
            <Pick label="Method" value={opts.cp.method} onChange={(v) => patch("cp", { method: v, maxChanges: 0 })}
              options={CP_METHOD_OPTIONS} />
            <Pick label="Change in" value={opts.cp.cost} onChange={(v) => patch("cp", { cost: v })}
              options={CP_COST_OPTIONS} />
            <Pick label="Penalty" value={opts.cp.penalty} onChange={(v) => patch("cp", { penalty: v })}
              options={CP_PENALTY_OPTIONS} />
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
              options={ARIMA_TREND_OPTIONS} />
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
