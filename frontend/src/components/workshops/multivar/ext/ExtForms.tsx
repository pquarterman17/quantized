// PLS / LDA / spectra PCA tab: the per-tool settings (view). Numeric fields
// commit on Enter/blur (BufferedNumberField); prepareExt validates before a run.

import BufferedNumberField from "../../../primitives/BufferedNumberField";
import { Checkbox } from "../../../primitives/Checkbox";
import { Select } from "../../../primitives";
import type { MultivarState } from "../useMultivar";
import type { MultivarExtState } from "./useMultivarExt";

const row = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 } as const;

function Num({ label, value, min, max, onValue, hint }: {
  label: string; value: number; min?: number; max?: number; onValue: (v: number) => void; hint?: string;
}) {
  return (
    <div title={hint}>
      <label className="qzk-field-lbl">{label}</label>
      <BufferedNumberField aria-label={label} type="number" width={72} required min={min} max={max} step={1}
        value={value} onValue={(v) => { if (v !== undefined) onValue(Math.round(v)); }} />
    </div>
  );
}

export default function ExtForms({ x, m }: { x: MultivarExtState; m: MultivarState }) {
  const { opts, patch } = x;
  const chans = m.columns;
  if (x.tool === "pls") {
    const p = opts.pls;
    return (
      <div>
        <div style={row}>
          <div style={{ minWidth: 150 }}>
            <label className="qzk-field-lbl">Layout</label>
            <Select aria-label="PLS layout" value={p.orientation} onChange={(e) => patch("pls", { orientation: e.target.value as "cols" | "spectra" })}
              options={[{ value: "cols", label: "Columns are variables" }, { value: "spectra", label: "Columns are spectra (samples)" }]} />
          </div>
          <div style={{ minWidth: 120 }}>
            <label className="qzk-field-lbl">Preprocessing</label>
            <Select aria-label="Preprocessing" value={p.preprocess} onChange={(e) => patch("pls", { preprocess: e.target.value as typeof p.preprocess })}
              options={[{ value: "center", label: "Mean-centre" }, { value: "autoscale", label: "Autoscale (unit variance)" }, { value: "none", label: "None" }]} />
          </div>
        </div>
        {p.orientation === "cols" ? (
          <div style={{ marginTop: 8 }}>
            <label className="qzk-field-lbl">Response (Y) columns; the other selected columns above are the predictors</label>
            <div style={{ maxHeight: 90, overflowY: "auto", border: "1px solid var(--border-soft)", borderRadius: 4, padding: 6 }}>
              {chans.map((c) => (
                <Checkbox key={c.index} checked={p.y.includes(c.index)}
                  onChange={() => patch("pls", { y: p.y.includes(c.index) ? p.y.filter((v) => v !== c.index) : [...p.y, c.index].sort((a, b) => a - b) })}>
                  {c.label}
                </Checkbox>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <label className="qzk-field-lbl">Response per spectrum ({m.selected.length} values, selected-column order)</label>
            <input aria-label="Response values" className="qzk-input" style={{ width: "100%" }} value={p.yText} placeholder="e.g. 0.1, 0.25, 0.4, 0.55"
              onChange={(e) => patch("pls", { yText: e.target.value })} />
          </div>
        )}
        <div style={row}>
          <Num label="Max components" value={p.maxComp} min={1} max={50} onValue={(v) => patch("pls", { maxComp: v })} />
          <Num label="Components (0 = auto)" value={p.fixed} min={0} max={50} onValue={(v) => patch("pls", { fixed: v })}
            hint="0 picks the number with the smallest cross-validated PRESS" />
          <Num label="CV folds" value={p.folds} min={2} max={100} onValue={(v) => patch("pls", { folds: v })} />
          <Num label="Seed" value={p.seed} onValue={(v) => patch("pls", { seed: v })} hint="Fixed seed: the same folds every run" />
        </div>
      </div>
    );
  }
  if (x.tool === "lda") {
    const l = opts.lda;
    return (
      <div style={row}>
        <div style={{ minWidth: 140 }}>
          <label className="qzk-field-lbl">Class column</label>
          <Select aria-label="Class column" value={String(l.classCol)} onChange={(e) => patch("lda", { classCol: Number(e.target.value) })}
            options={[{ value: "-2", label: "Choose…" }, ...chans.map((c) => ({ value: String(c.index), label: c.label }))]} />
        </div>
        <div style={{ minWidth: 120 }}>
          <label className="qzk-field-lbl">Priors</label>
          <Select aria-label="Priors" value={l.priors} onChange={(e) => patch("lda", { priors: e.target.value as "empirical" | "equal" })}
            options={[{ value: "empirical", label: "Class frequencies" }, { value: "equal", label: "Equal" }]} />
        </div>
        <Num label="CV folds (0 = none)" value={l.cvFolds} min={0} max={100} onValue={(v) => patch("lda", { cvFolds: v })} />
        <Num label="Seed" value={l.seed} onValue={(v) => patch("lda", { seed: v })} />
      </div>
    );
  }
  return (
    <div style={row}>
      <Checkbox checked={opts.spectra.center} onChange={() => patch("spectra", { center: !opts.spectra.center })}>Mean-centre</Checkbox>
      <Checkbox checked={opts.spectra.scale} onChange={() => patch("spectra", { scale: !opts.spectra.scale })}>Scale each grid point to unit variance</Checkbox>
      <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", flexBasis: "100%" }}>
        Each selected column is one spectrum on this worksheet's X grid (so the grids match by construction).
        The server refuses spectra on different grids unless resampling is requested explicitly.
      </div>
    </div>
  );
}
