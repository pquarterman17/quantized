// Custom equation model panel (GOTO #1) — the "type y = f(x, p...)" entry
// path in the Curve Fit workshop. Equation field with live (debounced)
// validation, an auto-populated parameter table (guess/min/max), Fit through
// /api/fitting/equation/fit (same engine + stats as registry models), and
// save-as-named-model (lib/fitmodels) so the model reappears in the picker.
// Rendered by CurveFitPanel when the picker is on "Custom equation" or a
// saved model; kept as its own sub-component + hook (useEquationFit) so
// edits to the shared workshop files stay minimal.

import { Button, DataTable, NumberField } from "../../primitives";
import { fmtNum as fmt } from "../../../lib/format";
import type { CustomFitModel } from "../../../lib/fitmodels";
import { useEquationFit } from "./useEquationFit";

interface Props {
  /** Saved model to prefill from (picker selection), or null for a blank panel. */
  initial: CustomFitModel | null;
  /** Fired after save/delete so the picker options refresh. */
  onSavedChange: (models: CustomFitModel[]) => void;
}

export default function EquationModelPanel({ initial, onSavedChange }: Props) {
  const eq = useEquationFit(initial);

  const doSave = () => {
    const list = eq.save();
    if (list) onSavedChange(list);
  };

  const doDelete = () => {
    if (!initial) return;
    onSavedChange(eq.remove(initial.name));
  };

  const params = (eq.result?.params as number[] | undefined) ?? [];
  const errors = (eq.result?.errors as (number | null)[] | undefined) ?? [];
  const resultNames = (eq.result?.paramNames as string[] | undefined) ?? eq.paramNames;
  const paramRows = params.map((p, i) => [resultNames[i] ?? `p${i}`, fmt(p), fmt(errors[i])]);
  const statRows: (string | number)[][] = eq.result
    ? [
        ["R²", fmt(eq.result.R2)],
        ["RMSE", fmt(eq.result.RMSE)],
        ["AIC", fmt(eq.result.AIC)],
      ]
    : [];

  return (
    <div>
      <label className="qzk-field-lbl" style={{ marginTop: 10 }}>
        Equation
      </label>
      <input
        className="qz-input"
        style={{ width: "100%", fontFamily: "var(--font-mono)" }}
        placeholder="y = a*exp(-x/t) + c"
        value={eq.equation}
        onChange={(e) => eq.setEquation(e.target.value)}
        spellCheck={false}
      />
      <div className="qzk-ds-meta" style={{ marginTop: 6, minHeight: 16 }}>
        {eq.status === "checking" && (
          <span style={{ color: "var(--text-faint)" }}>checking…</span>
        )}
        {eq.status === "ok" && (
          <span style={{ color: "var(--text-faint)" }}>
            {eq.rows.length > 0
              ? `parameters: ${eq.rows.map((r) => r.name).join(", ")}`
              : "no free parameters — add at least one to fit"}
          </span>
        )}
        {eq.status === "error" && (
          <span style={{ color: "var(--danger)" }}>{eq.validationError}</span>
        )}
      </div>

      {eq.rows.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <DataTable
            columns={["param", "guess", "min", "max"]}
            rows={eq.rows.map((r, i) => [
              <span key="n" style={{ fontFamily: "var(--font-mono)" }}>
                {r.name}
              </span>,
              <NumberField
                key="g"
                width={60}
                value={r.guess}
                onChange={(v) => eq.setRow(i, "guess", v)}
                aria-label={`guess ${r.name}`}
              />,
              <NumberField
                key="lo"
                width={60}
                value={r.min}
                placeholder="−∞"
                onChange={(v) => eq.setRow(i, "min", v)}
                aria-label={`min ${r.name}`}
              />,
              <NumberField
                key="hi"
                width={60}
                value={r.max}
                placeholder="+∞"
                onChange={(v) => eq.setRow(i, "max", v)}
                aria-label={`max ${r.name}`}
              />,
            ])}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={!eq.active || eq.busy || eq.status !== "ok" || eq.rows.length === 0}
          onClick={() => void eq.fit()}
        >
          {eq.busy ? "Fitting…" : "Fit"}
        </Button>
        {eq.result && (
          <Button size="sm" onClick={eq.clear}>
            Clear
          </Button>
        )}
      </div>

      {!eq.active && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
          Select a dataset to fit.
        </div>
      )}
      {eq.error && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>
          {eq.error}
        </div>
      )}

      {paramRows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <DataTable columns={["param", "value", "± err"]} rows={paramRows} />
        </div>
      )}
      {statRows.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <DataTable columns={["stat", "value"]} rows={statRows} />
        </div>
      )}

      <label className="qzk-field-lbl" style={{ marginTop: 12 }}>
        Save as model
      </label>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="qz-input"
          style={{ flex: 1 }}
          placeholder="model name"
          value={eq.modelName}
          onChange={(e) => eq.setModelName(e.target.value)}
        />
        <Button
          size="sm"
          disabled={eq.status !== "ok" || eq.rows.length === 0 || !eq.modelName.trim()}
          onClick={doSave}
          title="Save the equation + guesses/bounds as a reusable named model"
        >
          Save
        </Button>
        {initial && (
          <Button size="sm" onClick={doDelete} title={`Delete saved model "${initial.name}"`}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
