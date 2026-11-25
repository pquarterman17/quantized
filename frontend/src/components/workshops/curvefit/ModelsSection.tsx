// Curve Fit -- piecewise, convolution and ODE fits (lazy chunk, GAP_AUDIT_9
// G11). Three model families the ordinary Fit cannot express: continuous
// piecewise-linear regression, the selected model convolved with an
// instrument function, and built-in rate-equation (ODE) models. The ordinary
// Fit button is untouched.

import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { DataTable } from "../../primitives/DataTable";
import { NumberField } from "../../primitives/NumberField";
import { fmtNum as fmt } from "../../../lib/format";
import type { FitModel } from "../../../lib/types";
import { useActiveDataset } from "../../../store/useApp";
import { OutOfDateNote, WorkbenchMessage } from "../workbench/WorkbenchParts";
import { useModelsFit, type ModelsMode, type ModelsRun, type OdeModelName } from "./useModelsFit";

const MODES: { value: ModelsMode; label: string }[] = [
  { value: "piecewise", label: "Piecewise linear (breakpoints)" },
  { value: "convolution", label: "Convolution with instrument (selected model)" },
  { value: "ode", label: "ODE model (built-in)" },
];
const ODES: { value: OdeModelName; label: string }[] = [
  { value: "first_order", label: "First-order decay" },
  { value: "sequential", label: "A to B to C" },
  { value: "logistic", label: "Logistic growth" },
];
const HINT: Record<ModelsMode, string> = {
  piecewise: "Continuous segments; breakpoints by least squares (SE is local and approximate). Fixed breakpoints are held, the rest estimated.",
  convolution: "Gaussian sigma held, or fitted when the model has no free width of its own. A measured resolution column is held. The model is evaluated slightly beyond the data range.",
  ode: "Fixed built-in systems solved with solve_ivp; nothing you type is evaluated. A to B to C holds B0 = C0 = 0. Rates start near 1/span.",
};

function rows(run: ModelsRun): string[][] {
  if (run.kind === "piecewise") {
    const r = run.result;
    return [
      ["intercept", fmt(r.intercept), fmt(r.interceptSe)],
      ...r.slopes.map((s, i) => [`slope ${i + 1} (${fmt(s.xStart)} to ${fmt(s.xEnd)})`, fmt(s.slope), fmt(s.se)]),
      ...r.breakpoints.map((b, i) => [`breakpoint ${i + 1}${b.fixed ? " (fixed)" : ""}`, fmt(b.value), b.fixed ? "-" : fmt(b.se)]),
    ];
  }
  const r = run.result;
  const names = r.paramNames;
  return r.params.map((v, i) => [names[i] ?? `p${i + 1}`, fmt(v), "held" in r && r.held.includes(names[i] ?? "") ? "held" : fmt(r.errors[i])]);
}

export default function ModelsSection({ modelName, model }: { modelName: string; model: FitModel | undefined }) {
  const f = useModelsFit(modelName, model);
  const active = useActiveDataset();
  const { settings: s, run } = f;
  const labels = active?.data.labels ?? [];
  const measured = s.resCol !== "";
  const colOptions = [{ value: "", label: "Gaussian instrument" }, ...labels.map((l, i) => ({ value: String(i), label: `Column: ${l}` }))];
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
      <label className="qzk-field-lbl">Piecewise, convolution and ODE fit</label>
      <Select
        options={MODES} value={s.mode} disabled={f.busy} aria-label="Model family"
        onChange={(e) => f.set({ mode: e.target.value as ModelsMode })}
      />
      <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        {s.mode === "piecewise" && (
          <>
            <label className="qzk-ds-meta">
              Breakpoints{" "}
              <NumberField value={s.nBreak} aria-label="Breakpoint count" disabled={f.busy} width={44} onChange={(v) => f.set({ nBreak: v })} />
            </label>
            <label className="qzk-ds-meta">
              Fixed at{" "}
              <NumberField
                value={s.fixedBreaks} numeric={false} placeholder="none" aria-label="Fixed breakpoints" disabled={f.busy} width={96}
                onChange={(v) => f.set({ fixedBreaks: v })}
              />
            </label>
          </>
        )}
        {s.mode === "convolution" && (
          <>
            <Select
              options={colOptions} value={s.resCol} disabled={f.busy} aria-label="Instrument function"
              onChange={(e) => f.set({ resCol: e.target.value })}
            />
            {!measured && (
              <>
                <label className="qzk-ds-meta">
                  Sigma{" "}
                  <NumberField value={s.sigma} aria-label="Instrument sigma" disabled={f.busy} width={64} onChange={(v) => f.set({ sigma: v })} />
                </label>
                <Checkbox checked={s.fitSigma} onChange={(fitSigma) => f.set({ fitSigma })}>Fit width</Checkbox>
              </>
            )}
          </>
        )}
        {s.mode === "ode" && (
          <>
            <Select
              options={ODES} value={s.odeModel} disabled={f.busy} aria-label="ODE model"
              onChange={(e) => f.set({ odeModel: e.target.value as OdeModelName })}
            />
            {s.odeModel === "sequential" && (
              <Select
                options={["A", "B", "C"].map((v) => ({ value: v, label: `Observe ${v}` }))} value={s.observe}
                disabled={f.busy} aria-label="Observed species"
                onChange={(e) => f.set({ observe: e.target.value as "A" | "B" | "C" })}
              />
            )}
          </>
        )}
        <Button size="sm" disabled={f.busy} aria-label="Run model fit" onClick={() => void f.go()}>
          {f.busy ? "Fitting…" : "Fit"}
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>{HINT[s.mode]}</div>
      <WorkbenchMessage refusal={f.refusal ? f.error : null} error={f.refusal ? null : f.error} />
      {run && !f.busy && (
        <div style={{ marginTop: 8 }}>
          {f.stale && <OutOfDateNote block>the data, model or settings changed after this fit. Fit again.</OutOfDateNote>}
          <DataTable columns={["param", "value", "± err"]} rows={rows(run)} />
          <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
            {`R2 ${fmt(run.result.rSquared)}, RSS ${fmt(run.result.rss)}, n = ${run.result.nPoints}`}
            {run.kind === "convolution" && run.result.instrumentSigma != null ? `, instrument sigma ${fmt(run.result.instrumentSigma)}` : ""}
            {run.kind !== "piecewise" && !run.result.success ? " (did not converge)" : ""}
          </div>
        </div>
      )}
    </div>
  );
}
