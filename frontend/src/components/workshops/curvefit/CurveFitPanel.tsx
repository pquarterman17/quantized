// Curve Fit workshop — view. A draggable ToolWindow: pick a model, auto-guess
// or fit the active dataset, see params (± errors) and goodness-of-fit. The
// fitted curve overlays on the plot via the store (see useCurveFit). Thin by
// design — all state/logic lives in the hook. "→ Report" lands the fit as a
// #36 report sheet in the library (emitted server-side, one source of truth).

import { useState } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import { Button, DataTable, Select } from "../../primitives";
import { reportEmit } from "../../../lib/api";
import { fmtNum as fmt } from "../../../lib/format";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";

export default function CurveFitPanel() {
  const setOpen = useApp((s) => s.setCurveFitOpen);
  const addReport = useApp((s) => s.addReport);
  const [reporting, setReporting] = useState(false);
  const {
    active,
    models,
    modelName,
    setModelName,
    result,
    guessOnly,
    busy,
    error,
    run,
    clear,
    runCornerPlot,
    cornerBusy,
  } = useCurveFit();

  const close = () => {
    clear();
    setOpen(false);
  };

  const toReport = async () => {
    if (!result || !active) return;
    setReporting(true);
    try {
      const names = models.find((m) => m.name === modelName)?.paramNames ?? [];
      const nParams = (result.params as number[] | undefined)?.length ?? 0;
      const { report } = await reportEmit({
        kind: "curve_fit",
        result: result as Record<string, unknown>,
        param_names: names.length === nParams ? names : Array.from({ length: nParams }, (_, i) => `p${i}`),
        model_name: modelName,
        title: `${modelName} fit — ${active.name}`,
        source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
      });
      addReport(`${modelName} fit — ${active.name}`, report, active.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "report failed", "danger");
    } finally {
      setReporting(false);
    }
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
      {result && !guessOnly && (
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          <Button size="sm" disabled={reporting} onClick={() => void toReport()}>
            {reporting ? "Reporting…" : "→ Report"}
          </Button>
          <Button
            size="sm"
            disabled={cornerBusy}
            title="Bootstrap the fit and export a pairwise parameter-uncertainty corner plot"
            onClick={() => void runCornerPlot()}
          >
            {cornerBusy ? "Bootstrapping…" : "Corner plot…"}
          </Button>
        </div>
      )}
    </ToolWindow>
  );
}
