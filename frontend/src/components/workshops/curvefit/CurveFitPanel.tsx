// Curve Fit workshop — view. A dockable ToolWindow: pick a model, auto-guess
// or fit the active dataset, see params (± errors) and goodness-of-fit. The
// fitted curve overlays on the plot via the store (see useCurveFit). Thin by
// design — all state/logic lives in the hook, the result area in
// CurveFitResults. "→ Report" lands the fit as a #36 report sheet in the
// library (emitted server-side, one source of truth).
//
// Layout (UX-F, audit 7 finding 4): a sticky header — model, the PRIMARY Fit
// button and the fit's status — over three tabs: Setup (inputs, weighting,
// start values, By), Results (the fit, residual plots open, then the deeper
// result tools) and Advanced (batch, templates, compare, ODR, scan, bumps).
// Fit switches to Results, so the outcome and the Fit button are both in view
// without scrolling. Every tab stays mounted (hidden) once shown, so a running
// batch or an open report survives a TAB switch -- not a switch into Global
// fit or a custom equation, which replaces the whole body.
//
// Closing the window only HIDES it: the fit, its curve, its recipe (so auto
// re-fit) and its Library result stay, and reopening shows the result again
// (store/curveFitSession.ts). Deleting a fit is the explicit, confirmed, undoable
// "Remove fit". The window opens docked in the side column (store/toolDock.ts),
// so it never covers the plot or the Inspector.

import { useEffect, useRef, useState } from "react";

import { WorkbenchMessage } from "../workbench/WorkbenchParts";
import ToolWindow from "../../overlays/ToolWindow";
import { floatingX } from "../../overlays/floatingX";
import { Select } from "../../primitives";
import { reportEmit } from "../../../lib/api";
import type { CustomFitModel } from "../../../lib/fitmodels";
import { groupFitModels } from "../../../lib/fitModelCatalog";
import { lazyRegion } from "../../../lib/lazyRegion";
import { addReportWithProvenance } from "../../../store/addReportWithProvenance";
import { askConfirm } from "../../../store/confirmDialog";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import CurveFitAdvanced from "./CurveFitAdvanced";
import CurveFitByResults from "./CurveFitByResults";
import CurveFitHeader, { CurveFitModelPicker, CurveFitTabPanel as TabPanel, type CurveFitTab } from "./CurveFitHeader";
import EquationModelPanel from "./EquationModelPanel";
import CurveFitResults from "./CurveFitResults";
import FitConvergenceWarning from "./FitConvergenceWarning";
import ModelScanSection from "./ModelScanSection";
import FitParamsSection from "./FitParamsSection";
import WeightingSection from "./WeightingSection";
import { curveFitStatus, isLinearFamily, poorFit } from "./curveFitStatus";
import { useLineFitNote } from "./lineFitStatus";
import FitRangeBar from "./FitRangeBar";
import { isSinglePeakModel } from "./fitRange";
import { reportPrefs } from "../../../store/curveFitSession";
import { useCurveFit } from "./useCurveFit";
import { useFitTemplateBinding } from "./useFitTemplateBinding";
import { useModelScan } from "./useModelScan";
import { useSavedFitModels } from "./useSavedFitModels";
import AnalysisInputReview from "../analysisselection/AnalysisInputReview";
import { ROW_POLICY } from "../../../lib/analysisInputs";
import { clearSelectionForTool, useAnalysisSelection } from "../../../store/analysisSelection";
import { connectionHint } from "../../../lib/importFailureHint";
import { historyTop, toastWithUndo } from "../../../lib/undoToast";

// Global (shared-parameter) fit mode: replaces the single-fit body while on.
const GlobalFitSection = lazyRegion(() => import("./GlobalFitSection"), "Global fit");
// Named settings (fit templates): the shared preset bar, lazy.
const CurveFitPresetBar = lazyRegion(() => import("./CurveFitPresetBar"), "Presets");

// Custom-model picker values are namespaced "custom:<name>"; the bare prefix
// is the blank "type a new equation" entry (GOTO #1).
const CUSTOM_PREFIX = "custom:";

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
  const lastUsedRef = useRef<(() => void) | null>(null); // writes "last used" when a fit succeeds
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
    refusal,
    run,
    clear,
    runCornerPlot,
    cornerBusy,
    xRange,
    fitXy,
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
    // JMP_GAP J7 residual — "By" grouping (display-only; see
    // useCurveFitByLevel's header doc).
    byOptions,
    byCol,
    setByCol,
    byLevels,
    byBusy,
    byRun,
  } = useCurveFit(lastUsedRef);
  const byActive = byLevels.length > 0;
  // Reopening on a fit shows it; otherwise start at Setup. Fit switches here.
  const [batchOpenSignal, setBatchOpenSignal] = useState(0);
  const lineFit = useLineFitNote((s) => s.note); // a York / ODR result made in the Advanced tab
  const [tab, setTab] = useState<CurveFitTab>(() => (result && !guessOnly) || active?.fitSpec?.params?.length ? "results" : "setup");
  const [runKind, setRunKind] = useState<"guess" | "fit">("fit"); // what `busy` is doing

  const fitParams = (
    <FitParamsSection
      rows={paramInputs} setRow={setParamRow} reset={resetParamRows}
      preview={{ active, model: models.find((m) => m.name === modelName), modelName, xy: fitXy, landed: fitData ? result : null }}
    />
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
  const customOptions = [
    { value: CUSTOM_PREFIX, label: "Custom equation…" },
    ...customModels.map((m) => ({ value: `${CUSTOM_PREFIX}${m.name}`, label: customLabel(m) })),
  ];
  // Grouped by Origin category, with aliases spelled out (lib/fitModelCatalog).
  const modelGroups = groupFitModels(models);
  const modelOptions = [...modelGroups.flatMap((g) => g.options), ...customOptions];
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
    toastWithUndo(`removed the ${modelName} fit of ${active.name}`, "info", historyTop());
  };

  const template = useFitTemplateBinding({
    active, models, modelName, setModelName, weightMode, setWeightMode, manualKey, setManualKey,
    scaleErrors, setScaleErrors, paramRows: paramInputs, replaceParamRows,
  });

  lastUsedRef.current = () => {
    if (models.some((m) => m.name === modelName)) void import("./presetAdapter").then((m) => m.recordCurveFitRun(template.current)).catch(() => undefined);
  };
  const [startedFromFit] = useState(() => !!active?.fitSpec?.model); // opened on a sheet's saved fit: that outranks a preset

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
    <CurveFitModelPicker groups={modelGroups} custom={customOptions} value={modelName} onChange={setModelName}
      globalMode={globalMode} onGlobalMode={() => setGlobalMode((v) => !v)} />
  );
  // The fit range (UX8-D): only the registry fit reads it; the bar stays mounted to take its ranges out.
  const fitCtx = { linear: isLinearFamily(registryModel?.category), peak: isSinglePeakModel(registryModel?.category), weights: fitData?.weights };
  const fitted = !globalMode && !isCustom && !!result && !guessOnly && !resultStale;
  const rangeBar = <FitRangeBar active={active} enabled={!globalMode && !isCustom} fitted={fitted} offer={!globalMode && !isCustom && (isSinglePeakModel(registryModel?.category) || (fitted && !!poorFit(result!, fitCtx)))} />;

  if (globalMode) {
    const reg = models.find((m) => m.name === modelName);
    const globalModel = currentCustom
      ? { name: currentCustom.name, paramNames: currentCustom.params, p0: currentCustom.guesses.map((g) => g ?? 1), lb: currentCustom.lower, ub: currentCustom.upper, equation: currentCustom.equation }
      : (reg ?? null);
    return (
      <ToolWindow id="curvefit" title="Curve fit" width={360} x={floatingX(360, "curvefit")} dockable busy={busy} onClose={close} header={<CurveFitHeader modelPicker={modelPicker} range={rangeBar} />}>
        <AnalysisInputReview toolId="curvefit" singleY policy={ROW_POLICY.analysisView} />
        <GlobalFitSection model={globalModel} />
      </ToolWindow>
    );
  }

  // Custom-equation mode: same window + picker, the equation panel below
  // (new sub-component — the registry-model body stays untouched).
  if (isCustom) {
    return (
      <ToolWindow id="curvefit" title="Curve fit" width={340} x={floatingX(340, "curvefit")} dockable busy={busy} onClose={close} header={<CurveFitHeader modelPicker={modelPicker} range={rangeBar} />}>
        <AnalysisInputReview toolId="curvefit" singleY policy={ROW_POLICY.analysisView} />
        <EquationModelPanel
          key={modelName}
          initial={currentCustom}
        />
        <ModelScanSection state={modelScan} onApply={applyScanned} />
      </ToolWindow>
    );
  }

  const status = curveFitStatus({
    hasData: active != null, busy, guessing: runKind === "guess", error, result, guessOnly, stale: resultStale, byLevels: byActive ? byLevels.length : 0, byBusy, context: fitCtx,
    lineFit,
  });
  const header = (
    <CurveFitHeader
      modelPicker={modelPicker}
      range={rangeBar}
      fit={{
        disabled: !active || busy,
        fitting: busy && runKind === "fit",
        onGuess: () => (setRunKind("guess"), void run("guess")),
        onFit: () => (setRunKind("fit"), setTab("results"), void run("fit")),
        status,
        tab,
        onTab: setTab,
        onOpenBatch: () => setBatchOpenSignal((n) => n + 1),
      }}
    />
  );

  return (
    <ToolWindow id="curvefit" title="Curve fit" width={340} x={floatingX(340, "curvefit")} dockable busy={busy} onClose={close} header={header}>
      {/* Above the tabs: a failed fit OR auto-guess shows on whichever tab is open. */}
      <WorkbenchMessage refusal={refusal ? error : null} error={refusal || !error ? null : `${error}${connectionHint(error)}`} />
      <TabPanel id="setup" tab={tab}>
        <AnalysisInputReview toolId="curvefit" singleY allowFactor supportsBatch />
        {active && <CurveFitPresetBar template={template} fromResult={startedFromFit} running={busy} />}
        {weighting}
        {fitParams}

        {/* "By" grouping (JMP_GAP_PLAN J7 residual): re-runs this SAME model
            fit once per level of an optional categorical column, display-only
            (never touches the plot overlay/macro/FitSpec) and unweighted. */}
        {byOptions.length > 0 && (
          <div>
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
          </div>
        )}
      </TabPanel>

      <TabPanel id="results" tab={tab}>
        {!active && (
          <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>
            Select a dataset to fit.
          </div>
        )}
        {active && !result && !error && !busy && !byActive && !active.fitSpec?.params?.length && (
          <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
            No fit yet. Press Fit to fit {modelName} to the data.
          </div>
        )}
        {!byActive && <FitConvergenceWarning result={guessOnly ? null : result} />}

        {byActive ? (
          <CurveFitByResults active={active} by={byRun} paramNames={paramNames} />
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
            residualsOpen={tab === "results"}
          />
        )}
      </TabPanel>

      <TabPanel id="advanced" tab={tab} lazy>
        <CurveFitAdvanced
          active={active}
          modelName={modelName}
          registryModel={registryModel}
          paramRows={paramInputs}
          weightMode={weightMode}
          manualKey={manualKey}
          scaleErrors={scaleErrors}
          modelOptions={modelOptions}
          customModels={customModels}
          modelScan={modelScan}
          onApplyScanned={applyScanned}
          batchOpenSignal={batchOpenSignal}
        />
      </TabPanel>
    </ToolWindow>
  );
}
