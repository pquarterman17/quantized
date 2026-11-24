// Curve Fit -- robust and quantile fits (lazy chunk, GAP_AUDIT_9 G11).
// Plain least squares is dragged by outliers; this fits the same data with a
// robust loss (soft-L1 / Huber / Cauchy on the selected model), a Tukey-
// bisquare polynomial, or a quantile line. The ordinary Fit button is untouched.

import { Button, Select } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";
import { NumberField } from "../../primitives/NumberField";
import { fmtNum as fmt } from "../../../lib/format";
import type { FitModel } from "../../../lib/types";
import { OutOfDateNote, WorkbenchMessage } from "../workbench/WorkbenchParts";
import { useRobustFit, type RobustLoss, type RobustMode } from "./useRobustFit";

const MODES: { value: RobustMode; label: string }[] = [
  { value: "loss", label: "Robust loss (selected model)" },
  { value: "bisquare", label: "Tukey bisquare (polynomial)" },
  { value: "quantile", label: "Quantile regression (polynomial)" },
];
const LOSSES: { value: RobustLoss; label: string }[] = [
  { value: "soft_l1", label: "Soft L1" },
  { value: "huber", label: "Huber" },
  { value: "cauchy", label: "Cauchy" },
];

const HINT: Record<RobustMode, string> = {
  loss: "Scale: residual size beyond which a point counts as an outlier. Blank = automatic (1.4826 x MAD of the least-squares residuals; provisional). Errors are approximate.",
  bisquare: "Tuning constant 4.685 (95% efficiency); scale from the median absolute residual. Errors: Huber H1 covariance.",
  quantile: "Fits the tau-quantile of y given x (0.5 = median). Errors: kernel sandwich (Powell); provisional.",
};

export default function RobustSection({ modelName, model }: { modelName: string; model: FitModel | undefined }) {
  const f = useRobustFit(modelName, model);
  const { settings: s, run } = f;
  const poly = s.mode !== "loss";
  const res = run?.result;
  const names = res && "paramNames" in res && res.paramNames ? res.paramNames : null;
  const values = res ? ("params" in res && res.params ? res.params : res.coefficients) ?? [] : [];
  const ls = res && "lsParams" in res && res.lsParams ? res.lsParams : res && "olsCoefficients" in res ? res.olsCoefficients : undefined;
  const outliers = res && "outliers" in res ? res.outliers.length : null;
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
      <label className="qzk-field-lbl">Robust and quantile fit</label>
      <Select
        options={MODES} value={s.mode} disabled={f.busy}
        onChange={(e) => f.set({ mode: e.target.value as RobustMode })}
      />
      <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        {s.mode === "loss" && (
          <>
            <label className="qzk-ds-meta">
              Robust loss{" "}
              <Select
                options={LOSSES} value={s.loss} disabled={f.busy}
                onChange={(e) => f.set({ loss: e.target.value as RobustLoss })}
              />
            </label>
            <label className="qzk-ds-meta">
              Scale{" "}
              <NumberField
                value={s.fScale} placeholder="auto" aria-label="Robust scale" disabled={f.busy} width={64}
                onChange={(v) => f.set({ fScale: v })}
              />
            </label>
          </>
        )}
        {poly && (
          <label className="qzk-ds-meta">
            Degree{" "}
            <NumberField value={s.degree} aria-label="Polynomial degree" disabled={f.busy} width={44} onChange={(v) => f.set({ degree: v })} />
          </label>
        )}
        {s.mode === "quantile" && (
          <label className="qzk-ds-meta">
            tau{" "}
            <NumberField value={s.tau} aria-label="Quantile tau" disabled={f.busy} width={56} onChange={(v) => f.set({ tau: v })} />
          </label>
        )}
        <Button size="sm" disabled={f.busy} aria-label="Run robust fit" onClick={() => void f.go()}>
          {f.busy ? "Fitting…" : "Fit"}
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>{HINT[s.mode]}</div>
      <WorkbenchMessage refusal={f.refusal ? f.error : null} error={f.refusal ? null : f.error} />
      {res && !f.busy && (
        <div style={{ marginTop: 8 }}>
          {f.stale && <OutOfDateNote block>the data, model or settings changed after this fit. Fit again.</OutOfDateNote>}
          <DataTable
            columns={["param", "robust", "± err", "least squares"]}
            rows={values.map((v, i) => [
              names?.[i] ?? (poly ? `x^${i}` : `p${i + 1}`),
              fmt(v), fmt(res.errors[i]), ls ? fmt(ls[i]) : "-",
            ])}
          />
          <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
            {run?.kind === "quantile"
              ? `tau = ${run.result.tau}, pseudo-R2 ${fmt(run.result.pseudoR2)}, n = ${run.result.nPoints}`
              : `${outliers ?? 0} downweighted point(s) (robust weight < 0.5)${res && "fScale" in res && res.fScale ? `, scale ${fmt(res.fScale)}${res.fScaleAuto ? " (auto)" : ""}` : ""}, n = ${res.nPoints}`}
          </div>
        </div>
      )}
    </div>
  );
}
