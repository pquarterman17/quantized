// Custom equation model panel (GOTO #1) — the "type y = f(x, p...)" entry
// path in the Curve Fit workshop. Equation field with live (debounced)
// validation, an auto-populated parameter table (guess/min/max), Fit through
// /api/fitting/equation/fit (same engine + stats as registry models), and
// save-as-named-model (lib/fitmodels) so the model reappears in the picker.
// Rendered by CurveFitPanel when the picker is on "Custom equation" or a
// saved model; kept as its own sub-component + hook (useEquationFit) so
// edits to the shared workshop files stay minimal.

import { DataTable } from "../../primitives/DataTable";
import { Button } from "../../primitives";
import { fmtNum as fmt } from "../../../lib/format";
import type { CustomFitModel } from "../../../lib/fitmodels";
import EquationEditor from "./EquationEditor";
import EquationParamTable from "./EquationParamTable";
import EquationSummary from "./EquationSummary";
import FindXYSection from "./FindXYSection";
import FitConvergenceWarning from "./FitConvergenceWarning";
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
  // A held parameter kept its guess and has no standard error (P2.7) — say
  // "held" rather than the blank a failed error estimate would show.
  // Units are display metadata from the table, matched by name (P2.7).
  const unitOf = (name: string | undefined) => {
    const u = eq.rows.find((r) => r.name === name)?.unit.trim();
    return u ? ` ${u}` : "";
  };
  const paramRows = params.map((p, i) => [
    resultNames[i] ?? `p${i}`,
    `${fmt(p)}${unitOf(resultNames[i])}`,
    eq.fitHeld[i] ? "held" : `${fmt(errors[i])}${Number.isFinite(errors[i]) ? unitOf(resultNames[i]) : ""}`,
  ]);
  const statRows: (string | number)[][] = eq.result
    ? [
        ["R²", fmt(eq.result.R2)],
        ["RMSE", fmt(eq.result.RMSE)],
        ["AIC", fmt(eq.result.AIC)],
      ]
    : [];

  return (
    <div>
      {/* ONE description field, at the top so a chosen saved model's text is
          the first thing shown (P2.7); it is what Save writes. */}
      <input
        className="qz-input"
        style={{ display: "block", width: "100%", marginTop: 8 }}
        placeholder="description (optional)"
        aria-label="model description"
        title="What this model is for — saved with it and shown in the model picker"
        value={eq.description}
        onChange={(e) => eq.setDescription(e.target.value)}
      />
      <label className="qzk-field-lbl" style={{ marginTop: 10 }}>
        Equation
      </label>
      <EquationEditor
        value={eq.equation}
        onChange={eq.setEquation}
        status={eq.status}
        validationError={eq.validationError}
        errorSpan={eq.errorSpan}
        noParams={eq.rows.length === 0}
      />

      {eq.status === "ok" && eq.summary && eq.rows.length > 0 && (
        <EquationSummary summary={eq.summary} rows={eq.rows} runProblem={eq.runProblem} />
      )}

      {eq.rows.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <EquationParamTable rows={eq.rows} setRow={eq.setRow} setHeld={eq.setHeld} />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={
            !eq.active || eq.busy || eq.status !== "ok" || eq.rows.length === 0 || eq.runProblem !== null
          }
          title={eq.runProblem ?? undefined}
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
      <FitConvergenceWarning result={eq.result} />

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

      {/* Find X from Y / Y from X (MAIN #15) — inverse-evaluate the fit. */}
      {eq.result && eq.xRange && (
        <FindXYSection
          target={{ equation: eq.equation, params, xMin: eq.xRange.min, xMax: eq.xRange.max }}
        />
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
          title="Save the equation + guesses/bounds/units + description as a reusable named model"
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
