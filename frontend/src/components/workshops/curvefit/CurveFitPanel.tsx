// Curve Fit workshop — view. A draggable ToolWindow: pick a model, auto-guess
// or fit the active dataset, see params (± errors) and goodness-of-fit. The
// fitted curve overlays on the plot via the store (see useCurveFit). Thin by
// design — all state/logic lives in the hook. "→ Report" lands the fit as a
// #36 report sheet in the library (emitted server-side, one source of truth).

import { useState } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import { DataTable } from "../../primitives/DataTable";
import { Button, Select } from "../../primitives";
import { reportEmit } from "../../../lib/api";
import { loadCustomModels, type CustomFitModel } from "../../../lib/fitmodels";
import { fmtNum as fmt } from "../../../lib/format";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import BumpsSection from "./BumpsSection";
import CurveFitByLevelSection from "./CurveFitByLevelSection";
import EquationModelPanel from "./EquationModelPanel";
import FitConvergenceWarning from "./FitConvergenceWarning";
import FindXYSection from "./FindXYSection";
import ModelScanSection from "./ModelScanSection";
import FitParamsSection from "./FitParamsSection";
import WeightingSection from "./WeightingSection";
import { useCurveFit } from "./useCurveFit";
import { useModelScan } from "./useModelScan";

// Custom-model picker values are namespaced "custom:<name>"; the bare prefix
// is the blank "type a new equation" entry (GOTO #1).
const CUSTOM_PREFIX = "custom:";

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
    xRange,
    weightMode,
    setWeightMode,
    manualKey,
    setManualKey,
    hasYErr,
    weightNote,
    // Renamed on destructure: `paramRows` below is the RESULTS table (fitted
    // value + error per parameter). This is the INPUT table.
    paramRows: paramInputs,
    setParamRow,
    resetParamRows,
    // JMP_GAP J7 residual — "By" grouping (display-only, unweighted; see
    // useCurveFitByLevel's header doc).
    byOptions,
    byCol,
    setByCol,
    byLevels,
    byTotalLevels,
    byResults,
    byBusy,
  } = useCurveFit();
  const byActive = byLevels.length > 0;

  const fitParams = (
    <FitParamsSection rows={paramInputs} setRow={setParamRow} reset={resetParamRows} />
  );

  const weighting = (
    <WeightingSection
      active={active}
      weightMode={weightMode}
      setWeightMode={setWeightMode}
      manualKey={manualKey}
      setManualKey={setManualKey}
      hasYErr={hasYErr}
      weightNote={weightNote}
    />
  );

  // AICc quick-scan (GOTO #6) — hook lives here so ranked results survive the
  // registry<->custom mode flip; a row click applies the model to the picker.
  const modelScan = useModelScan();
  const applyScanned = (kind: "registry" | "equation", name: string) =>
    setModelName(kind === "equation" ? `${CUSTOM_PREFIX}${name}` : name);

  // Saved custom equation models (GOTO #1) — listed alongside registry models.
  const [customModels, setCustomModels] = useState<CustomFitModel[]>(() => loadCustomModels());
  const isCustom = modelName.startsWith(CUSTOM_PREFIX);
  const customName = isCustom ? modelName.slice(CUSTOM_PREFIX.length) : "";
  const currentCustom = customModels.find((m) => m.name === customName) ?? null;
  const modelOptions = [
    ...models.map((m) => ({ value: m.name, label: m.name })),
    { value: CUSTOM_PREFIX, label: "Custom equation…" },
    ...customModels.map((m) => ({ value: `${CUSTOM_PREFIX}${m.name}`, label: `ƒ ${m.name}` })),
  ];
  const onSavedChange = (list: CustomFitModel[]) => {
    setCustomModels(list);
    // Deleting the loaded model orphans the picker value — fall back to blank.
    if (customName && !list.some((m) => m.name === customName)) setModelName(CUSTOM_PREFIX);
  };

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

  // Custom-equation mode: same window + picker, the equation panel below
  // (new sub-component — the registry-model body stays untouched).
  if (isCustom) {
    return (
      <ToolWindow id="curvefit" title="Curve Fit" width={340} onClose={close}>
        <label className="qzk-field-lbl">Model</label>
        <Select
          options={modelOptions}
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
        />
        <EquationModelPanel
          key={modelName}
          initial={currentCustom}
          onSavedChange={onSavedChange}
        />
        <ModelScanSection state={modelScan} onApply={applyScanned} />
      </ToolWindow>
    );
  }

  return (
    <ToolWindow id="curvefit" title="Curve Fit" width={340} onClose={close}>
      <label className="qzk-field-lbl">Model</label>
      <Select
        options={modelOptions}
        value={modelName}
        onChange={(e) => setModelName(e.target.value)}
      />

      {weighting}
      {fitParams}

      {/* "By" grouping (JMP_GAP_PLAN J7 residual): re-runs this SAME model
          fit once per level of an optional categorical column, display-only
          (never touches the plot overlay/macro/FitSpec) and unweighted. */}
      {byOptions.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <label className="qzk-field-lbl">By (optional)</label>
          <Select
            aria-label="By (optional)"
            options={[{ value: "", label: "None" }, ...byOptions.map((c) => ({ value: String(c.index), label: c.label }))]}
            value={byCol == null ? "" : String(byCol)}
            onChange={(e) => setByCol(e.target.value === "" ? null : Number(e.target.value))}
          />
          {byActive && weightMode !== "none" && (
            <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
              By levels fit unweighted (weighting is not yet supported per level)
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Button size="sm" disabled={!active || busy} onClick={() => void run("guess")}>
          Auto-guess
        </Button>
        <Button variant="primary" size="sm" disabled={!active || busy} onClick={() => void run("fit")}>
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
      {!byActive && <FitConvergenceWarning result={guessOnly ? null : result} />}

      {byActive ? (
        <>
          {byTotalLevels > byLevels.length && (
            <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
              By column has {byTotalLevels} levels — showing the first {byLevels.length}
            </div>
          )}
          {byBusy && byResults.length === 0 ? (
            <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
              fitting {byLevels.length} levels…
            </div>
          ) : (
            byResults.map((r) => (
              <CurveFitByLevelSection key={r.label} result={r} paramNames={paramNames} />
            ))
          )}
        </>
      ) : (
        <>
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

          {/* Find X from Y / Y from X (MAIN #15) — inverse-evaluate the fit. */}
          {result && !guessOnly && xRange && (
            <FindXYSection target={{ model: modelName, params, xMin: xRange.min, xMax: xRange.max }} />
          )}
        </>
      )}

      {/* AICc quick-scan (GOTO #6) — rank all plausible models; click applies. */}
      <ModelScanSection state={modelScan} onApply={applyScanned} />

      {/* Optional bumps engine (GOTO #10) — self-contained; parity stays default. */}
      <BumpsSection modelName={modelName} />
    </ToolWindow>
  );
}
