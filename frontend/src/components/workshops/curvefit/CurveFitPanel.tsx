// Curve Fit workshop — view. A draggable ToolWindow: pick a model, auto-guess
// or fit the active dataset, see params (± errors) and goodness-of-fit. The
// fitted curve overlays on the plot via the store (see useCurveFit). Thin by
// design — all state/logic lives in the hook.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, DataTable, Select } from "../../primitives";
import { fmtNum as fmt } from "../../../lib/format";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";

export default function CurveFitPanel() {
  const setOpen = useApp((s) => s.setCurveFitOpen);
  const { active, models, modelName, setModelName, result, guessOnly, busy, error, run, clear } =
    useCurveFit();

  const close = () => {
    clear();
    setOpen(false);
  };

  const paramNames = models.find((m) => m.name === modelName)?.paramNames ?? [];
  const params = (result?.params as number[] | undefined) ?? [];
  const errors = (result?.errors as (number | null)[] | undefined) ?? [];

  const paramRows = params.map((p, i) => [
    paramNames[i] ?? `p${i}`,
    fmt(p),
    guessOnly ? "—" : fmt(errors[i]),
  ]);

  const statRows: (string | number)[][] =
    guessOnly || !result
      ? []
      : [
          ["R²", fmt(result.R2)],
          ["RMSE", fmt(result.RMSE)],
          ["AIC", fmt(result.AIC)],
        ];

  return (
    <ToolWindow title="Curve Fit" width={340} onClose={close}>
      <label className="qzk-field-lbl">Model</label>
      <Select
        options={models.map((m) => ({ value: m.name, label: m.name }))}
        value={modelName}
        onChange={(e) => setModelName(e.target.value)}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Button size="sm" disabled={!active || busy} onClick={() => run("guess")}>
          Auto-guess
        </Button>
        <Button variant="primary" size="sm" disabled={!active || busy} onClick={() => run("fit")}>
          {busy ? "Fitting…" : "Fit"}
        </Button>
      </div>

      {!active && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
          Select a dataset to fit.
        </div>
      )}
      {error && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>
          {error}
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
    </ToolWindow>
  );
}
