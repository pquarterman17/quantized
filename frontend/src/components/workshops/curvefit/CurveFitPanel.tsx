// Curve Fit workshop — view. A draggable, resizable ToolWindow: pick a model,
// auto-guess or fit the active dataset, see params (± errors) and goodness-of-
// fit. The fitted curve overlays on the plot via the store (see useCurveFit).
// Thin by design — all state/logic lives in the hook, the result area in
// CurveFitResults. "→ Report" lands the fit as a #36 report sheet in the
// library (emitted server-side, one source of truth).
//
// Closing the window only HIDES it: the fit, its curve, its recipe (so auto
// re-fit) and its Library result stay, and reopening shows the result again
// (store/curveFitSession.ts). Deleting a fit is the explicit, confirmed, undoable
// "Remove fit". The window opens docked at the RIGHT edge so it never covers
// the plot's Y axis.

import { useEffect, useState } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { reportEmit } from "../../../lib/api";
import type { CustomFitModel } from "../../../lib/fitmodels";
import { lazyRegion } from "../../../lib/lazyRegion";
import { addReportWithProvenance } from "../../../store/addReportWithProvenance";
import { askConfirm } from "../../../store/confirmDialog";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import BumpsSection from "./BumpsSection";
import CurveFitByLevelSection from "./CurveFitByLevelSection";
import EquationModelPanel from "./EquationModelPanel";
import CurveFitResults from "./CurveFitResults";
import FitConvergenceWarning from "./FitConvergenceWarning";
import ModelScanSection from "./ModelScanSection";
import FitParamsSection from "./FitParamsSection";
import WeightingSection from "./WeightingSection";
import { reportPrefs } from "../../../store/curveFitSession";
import { useCurveFit } from "./useCurveFit";
import { useFitTemplateBinding } from "./useFitTemplateBinding";
import { useModelScan } from "./useModelScan";
import { useSavedFitModels } from "./useSavedFitModels";
import { xErrorChannel } from "./xErrorChannel";
import AnalysisInputReview from "../analysisselection/AnalysisInputReview";
import { clearSelectionForTool, useAnalysisSelection } from "../../../store/analysisSelection";
import CurveFitBatchSection from "./CurveFitBatchSection";

// Each its own chunk, fetched only when shown.
const FitTemplatesSection = lazyRegion(() => import("./FitTemplatesSection"), "Templates");
const CompareModelsSection = lazyRegion(() => import("./CompareModelsSection"), "Compare models");
const OdrSection = lazyRegion(() => import("./OdrSection"), "ODR");
// Global (shared-parameter) fit mode: replaces the single-fit body while on.
const GlobalFitSection = lazyRegion(() => import("./GlobalFitSection"), "Global fit");

// Custom-model picker values are namespaced "custom:<name>"; the bare prefix
// is the blank "type a new equation" entry (GOTO #1).
const CUSTOM_PREFIX = "custom:";

/** Default x of a Curve Fit window `width` px wide: docked at the right edge,
 *  clear of the plot's Y axis (the old x = 120 sat on it). */
function dockedX(width: number): number {
  return typeof window === "undefined" ? 120 : Math.max(16, window.innerWidth - width - 16);
}

// Unreadable saved models are reported ONCE per session however often the
// panel mounts (P2.7 slice 3: tolerant load, single warning).
const warnedModelLoads = new Set<string>();

/** Picker label of a saved model: its name plus the start of its description. */
function customLabel(m: CustomFitModel): string {
  const d = m.description?.trim();
  if (!d) return `ƒ ${m.name}`;
  return `ƒ ${m.name} — ${d.length > 32 ? `${d.slice(0, 31)}…` : d}`;
}

export default function CurveFitPanel() {
  const setOpen = useApp((s) => s.setCurveFitOpen);
  const recordHistory = useApp((s) => s.recordHistory);
  const updateAnalysisItem = useAnalysisSelection((state) => state.updateItem);
  const [reporting, setReporting] = useState(false);
  const [globalMode, setGlobalMode] = useState(false);
  const {
    active,
    models,
    modelName,
    setModelName,
    result,
    fitData,
    resultStale,
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
    scaleErrors,
    setScaleErrors,
    hasYErr,
    weightNote,
    // Renamed on destructure: `paramRows` below is the RESULTS table (fitted
    // value + error per parameter). This is the INPUT table.
    paramRows: paramInputs,
    setParamRow,
    replaceParamRows,
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
      scaleErrors={scaleErrors}
      setScaleErrors={setScaleErrors}
      hasYErr={hasYErr}
      weightNote={weightNote}
    />
  );

  // AICc quick-scan (GOTO #6) — hook lives here so ranked results survive the
  // registry<->custom mode flip; a row click applies the model to the picker.
  const modelScan = useModelScan();
  const applyScanned = (kind: "registry" | "equation", name: string) =>
    setModelName(kind === "equation" ? `${CUSTOM_PREFIX}${name}` : name);

  // Saved custom equation models (GOTO #1) — listed alongside registry models,
  // re-read on every library write (a save here, or a project open merging
  // models in — PR #432 review).
  const storedModels = useSavedFitModels();
  const customModels = storedModels.models;
  useEffect(() => {
    const w = storedModels.warning;
    if (w && !warnedModelLoads.has(w)) {
      warnedModelLoads.add(w);
      toast(w, "danger");
    }
  }, [storedModels]);
  const isCustom = modelName.startsWith(CUSTOM_PREFIX);
  const customName = isCustom ? modelName.slice(CUSTOM_PREFIX.length) : "";
  const currentCustom = customModels.find((m) => m.name === customName) ?? null;
  const modelOptions = [
    ...models.map((m) => ({ value: m.name, label: m.name })),
    { value: CUSTOM_PREFIX, label: "Custom equation…" },
    ...customModels.map((m) => ({ value: `${CUSTOM_PREFIX}${m.name}`, label: customLabel(m) })),
  ];
  // Deleting (or renaming) the loaded model — here, in the Recipe Library, or
  // anywhere else that writes the library — orphans the picker value: fall
  // back to the blank equation instead of a value no option matches.
  const orphaned = customName !== "" && currentCustom === null;
  useEffect(() => {
    if (orphaned) setModelName(CUSTOM_PREFIX);
  }, [orphaned, setModelName]);

  // Hide, never delete (see the header).
  const close = () => {
    clearSelectionForTool("curvefit");
    setOpen(false);
  };

  const removeFit = async () => {
    if (!active) return;
    const ok = await askConfirm(
      "Remove this fit?",
      `Deletes the ${modelName} fit of ${active.name}: its curve, its saved recipe (it stops re-fitting when the data change) and its Library result. Undo restores it.`,
      "Remove fit",
      true,
    );
    if (!ok) return;
    recordHistory("remove fit");
    clear();
  };

  const template = useFitTemplateBinding({
    active, models, modelName, setModelName, weightMode, setWeightMode, manualKey, setManualKey,
    paramRows: paramInputs, replaceParamRows,
  });

  const toReport = async () => {
    if (!result || !active) return;
    setReporting(true);
    try {
      const names = models.find((m) => m.name === modelName)?.paramNames ?? [];
      const nParams = (result.params as number[] | undefined)?.length ?? 0;
      // `dy` (or a direct fit's `weights`) + `ciLevel` let the report sheet
      // carry the NLFit inference/ANOVA tables on the fit's own weighting
      // (calc/report_emit_fit.py).
      const { report } = await reportEmit({
        kind: "curve_fit",
        result: {
          ...result,
          ...(fitData?.dy ? { dy: fitData.dy } : {}),
          ...(fitData?.weights ? { weights: fitData.weights } : {}),
          ciLevel: reportPrefs.level,
        } as Record<string, unknown>,
        param_names: names.length === nParams ? names : Array.from({ length: nParams }, (_, i) => `p${i}`),
        model_name: modelName,
        title: `${modelName} fit — ${active.name}`,
        source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
      });
      addReportWithProvenance(`${modelName} fit — ${active.name}`, report, active.id);
    } catch (e) {
      toast(`could not add to report — ${e instanceof Error ? e.message : "unknown error"}`, "danger");
    } finally {
      setReporting(false);
    }
  };

  const paramNames = models.find((m) => m.name === modelName)?.paramNames ?? [];
  const registryModel = models.find((m) => m.name === modelName);

  const modelPicker = (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <label className="qzk-field-lbl">Model</label>
        <Button
          size="sm"
          variant={globalMode ? "primary" : "ghost"}
          aria-pressed={globalMode}
          title="Fit one model to several series with shared parameters"
          onClick={() => setGlobalMode((v) => !v)}
        >
          Global fit
        </Button>
      </div>
      <Select
        aria-label="Model"
        options={modelOptions}
        value={modelName}
        onChange={(e) => setModelName(e.target.value)}
      />
    </>
  );

  if (globalMode) {
    const reg = models.find((m) => m.name === modelName);
    const globalModel = currentCustom
      ? { name: currentCustom.name, paramNames: currentCustom.params, p0: currentCustom.guesses.map((g) => g ?? 1), lb: currentCustom.lower, ub: currentCustom.upper, equation: currentCustom.equation }
      : (reg ?? null);
    return (
      <ToolWindow id="curvefit" title="Curve Fit" width={360} x={dockedX(360)} onClose={close}>
        <AnalysisInputReview toolId="curvefit" singleY />
        {modelPicker}
        <GlobalFitSection model={globalModel} />
      </ToolWindow>
    );
  }

  // Custom-equation mode: same window + picker, the equation panel below
  // (new sub-component — the registry-model body stays untouched).
  if (isCustom) {
    return (
      <ToolWindow id="curvefit" title="Curve Fit" width={340} x={dockedX(340)} onClose={close}>
        <AnalysisInputReview toolId="curvefit" singleY />
        {modelPicker}
        <EquationModelPanel
          key={modelName}
          initial={currentCustom}
        />
        <ModelScanSection state={modelScan} onApply={applyScanned} />
      </ToolWindow>
    );
  }

  return (
    <ToolWindow id="curvefit" title="Curve Fit" width={340} x={dockedX(340)} onClose={close}>
      <AnalysisInputReview toolId="curvefit" singleY allowFactor supportsBatch />
      {modelPicker}

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
            onChange={(e) => {
              const factor = e.target.value === "" ? null : Number(e.target.value);
              setByCol(factor);
              if (active) updateAnalysisItem(active.id, { factorKeys: factor === null ? [] : [factor] });
            }}
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
        <CurveFitResults
          active={active}
          modelName={modelName}
          paramNames={paramNames}
          result={result}
          fitData={fitData}
          guessOnly={guessOnly}
          stale={resultStale}
          xRange={xRange}
          reporting={reporting}
          onReport={() => void toReport()}
          cornerBusy={cornerBusy}
          onCornerPlot={() => void runCornerPlot()}
          onRemoveFit={() => void removeFit()}
        />
      )}

      {/* Batch across worksheets (below the results, which come first). */}
      <CurveFitBatchSection modelName={modelName} model={registryModel} paramRows={paramInputs} weightMode={weightMode} manualKey={manualKey} />

      {/* Save / apply named fit settings. */}
      <FitTemplatesSection current={template.current} apply={template.apply} />

      {/* Fit 2+ models to this selection and compare them. */}
      <CompareModelsSection options={modelOptions} current={modelName} customModels={customModels} />

      {/* Errors in x and y: offered only with an X-error column. */}
      {xErrorChannel(active) != null && <OdrSection />}

      {/* AICc quick-scan (GOTO #6) — rank all plausible models; click applies. */}
      <ModelScanSection state={modelScan} onApply={applyScanned} />

      {/* Optional bumps engine (GOTO #10) — self-contained; parity stays default. */}
      <BumpsSection modelName={modelName} />
    </ToolWindow>
  );
}
