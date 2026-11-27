// "Open in <tool>" for a committed analysis output (lane RO): reopen the
// producing tool on the RECORDED source with the RECORDED settings, as an
// editing session (store/toolReopen.ts) whose commit replaces the old output
// in one undo step, or adds a new one. Lazy (reached from the result workspace
// and the Library's result menu only).
//
// Fail closed: the plan (lib/committedOutputReopen.ts) decides; a refused plan
// opens nothing and says why. A missing source still opens the tool, but with a
// notice and no settings, and never on a silently different worksheet's data.

import { planReopen, type ReopenPlan } from "../lib/committedOutputReopen";
import { gadgetFftSeed } from "../lib/gadgetFftReopenSeed";
import { gadgetCurve } from "../lib/quickfit";
import { frequencyCountSeed } from "../lib/frequencyCountReopenSeed";
import { DEFAULT_PARAMS } from "../lib/statsTests";
import { kaplanMeierSeed } from "../lib/kaplanMeierReopenSeed";
import { rowTParams, rowTSeed } from "../lib/rowTReopenSeed";
import { reopenOnRecordedRows } from "./recordedRangeNav";
import { clearSelectionForTool } from "./analysisSelection";
import { useAnalysisExtras, type AnalysisExtra } from "./analysisExtras";
import { openResampleDialog, useResampleDialog } from "./resampleDialog";
import { useStatsTestsStore } from "./statsTests";
import { useToolReopen } from "./toolReopen";
import { guardRecordedChannels, planRecordedChannels, recordedChannels } from "./toolReopenChannels";
import { guardRecordedTransform } from "./toolReopenTransform";
import { guardRecordedPicks } from "./toolReopenPicks";
import { endSessionWhenClosed } from "./toolReopenWatch";
import { useApp } from "./useApp";

const EXTRAS: readonly string[] = ["surface-fit", "optical-gap", "ellipse-fit", "curve-measure", "math-extras"] satisfies AnalysisExtra[];

/** Tools that run on the ACTIVE dataset's plotted X/Y (the batch tools in every picked dataset; the Magnetometry tabs): reopening plots the recorded channels. */
const CHANNEL_TOOLS: readonly string[] = ["peak-batch", "peak-batch-integrate", "peak-align", "mag-normalization", "mag-demag", "curie-weiss", "mag-background", "hysteresis-background"];

/** Whether each tool is open (the session ends when it closes: lane RO2). */
const isToolOpen = (tool: string): boolean => {
  const app = useApp.getState();
  switch (tool) {
    case "baseline-subtract": return app.baselineOpen;
    case "tabulate": return app.tabulateOpen;
    case "peak-batch": return app.peakWizardOpen;
    case "peak-batch-integrate": case "peak-align": return app.peaksOpen;
    case "spin-asymmetry": return app.reflectivityOpen;
    case "mag-normalization": case "mag-demag": case "curie-weiss": case "mag-background": return app.magToolsOpen;
    case "hysteresis-background": return app.hysteresisOpen;
    case "fit-band": return app.curveFitOpen;
    case "fft-thickness": case "reflectivity-fft": case "pawley": return app.reductionsOpen;
    case "signal-spectrogram": return app.signalProcessingOpen;
    case "resample": return useResampleDialog.getState().seed !== null;
    case "average-curves": return app.datasetMathOpen && app.datasetMathMode === "average";
    case "km-curve": case "row-t-tests": return useStatsTestsStore.getState().open;
    default: return useAnalysisExtras.getState().open.includes(tool as AnalysisExtra);
  }
};

/** True when the tool opened (with or without the recorded settings). A result whose tool read a row range reopens on
 *  that RECORDED range, not the live one, and is refused with the reason when its source changed since the save
 *  (store/recordedRangeNav.ts). */
export function openCommittedResultInTool(resultId: string): boolean {
  const result = useApp.getState().analysisResults.find((item) => item.id === resultId);
  const output = result && useApp.getState().datasets.find((d) => d.id === result.outputs[0]?.datasetId);
  return result ? reopenOnRecordedRows(result, output?.data.metadata, () => openPlannedResult(resultId)) : openPlannedResult(resultId);
}

function openPlannedResult(resultId: string): boolean {
  const app = useApp.getState();
  const result = app.analysisResults.find((item) => item.id === resultId);
  if (!result) {
    app.setStatus("that analysis result no longer exists", "danger");
    return false;
  }
  const planned = planReopen(result, app.datasets);
  if (!planned.ok) {
    app.setStatus(`${planned.label}: ${planned.reason}`, "danger");
    return false;
  }
  const plannedSource = planned.sourceId ? app.datasets.find((dataset) => dataset.id === planned.sourceId) : undefined;
  const plan = guardRecordedTransform(guardRecordedChannels(guardRecordedPicks(planned, plannedSource), plannedSource), app.datasets);
  // A batch tool runs on the plotted channels: plot the recorded ones, or say they moved.
  const source = plan.sourceId ? app.datasets.find((dataset) => dataset.id === plan.sourceId) : undefined;
  const channels = CHANNEL_TOOLS.includes(plan.tool) && source && plan.seed
    ? planRecordedChannels(source, recordedChannels(plan.extra)) : null;
  const fitBand = plan.tool === "fit-band" && plan.seed ? `Curve Fit opens with this band's level and prediction setting; fit “${String(plan.seed["model"])}” on this worksheet again. Replace is available only while the live fit matches the one this band was drawn from.` : null;
  const notice = [plan.notice, channels?.kind === "problem" ? channels.problem : null, fitBand].filter(Boolean).join(" ") || null;
  if (plan.tool === "gadget-fft") return reopenGadgetFft(plan, result.name, notice);
  useToolReopen.getState().start(plan.tool, {
    resultId: result.id, resultName: result.name, sourceId: plan.sourceId, sourceIds: plan.sourceIds, outputId: plan.outputId,
    outputName: plan.outputName, seed: plan.seed, extra: plan.extra, notice, replaceBlocked: plan.replaceBlocked,
  });
  if (plan.sourceId) app.setActive(plan.sourceId);
  if (plan.tool === "frequency-count") return reopenFrequencyCount(plan, result.name, notice);
  let replot = "";
  if (channels?.kind === "plot") {
    const now = useApp.getState();
    if (now.xKey !== channels.xKey || now.yKeys?.length !== 1 || now.yKeys[0] !== channels.yKey) {
      replot = `plotted “${channels.label}”, the channel this result ran on (Undo restores the previous plot); `;
      now.recordHistory(`plot the recorded ${plan.toolLabel} channel`);
      useApp.setState({ xKey: channels.xKey, yKeys: [channels.yKey] });
    }
  }
  if (plan.tool === "baseline-subtract") {
    // The estimate follows the plotted channels: plot the recorded ones.
    // Only when they differ, as ONE undoable view change (no macro step: the
    // user did not ask for it) that the status line names.
    const binding = plan.seed?.["binding"];
    if (plan.sourceId && binding && typeof binding === "object" && !Array.isArray(binding) && typeof binding["yKey"] === "number") {
      const xKey = typeof binding["xKey"] === "number" ? binding["xKey"] : null;
      const yKeys = [binding["yKey"]];
      const now = useApp.getState();
      if (now.xKey !== xKey || now.yKeys?.length !== 1 || now.yKeys[0] !== yKeys[0]) {
        replot = `plotted “${typeof binding["yLabel"] === "string" ? binding["yLabel"] : `channel ${yKeys[0]! + 1}`}”, the channel this result was estimated on (Undo restores the previous plot); `;
        now.recordHistory("plot the recorded Baseline channel");
        useApp.setState({ xKey, yKeys });
      }
    }
    app.setStageTab("plot");
    app.setBaselineOpen(true);
  } else if (plan.tool === "tabulate") {
    app.setTabulateOpen(true);
  } else if (plan.tool === "peak-batch") {
    app.setPeakWizardOpen(true);
  } else if (plan.tool === "peak-batch-integrate" || plan.tool === "peak-align") {
    app.setPeaksOpen(true);
  } else if (plan.tool === "mag-normalization" || plan.tool === "mag-demag" || plan.tool === "curie-weiss" || plan.tool === "mag-background") {
    app.setMagToolsOpen(true);
  } else if (plan.tool === "hysteresis-background") {
    // A reviewed (frozen) selection would override the recorded source and channels: open on the live ones.
    clearSelectionForTool("hysteresis");
    app.setHysteresisOpen(true);
  } else if (plan.tool === "resample") {
    openResampleDialog(plan.sourceId ? [plan.sourceId] : []);
  } else if (plan.tool === "average-curves") {
    app.setDatasetMathOpen(true, "average");
  } else if (plan.tool === "fit-band") {
    app.setCurveFitOpen(true);
  } else if (plan.tool === "fft-thickness" || plan.tool === "reflectivity-fft" || plan.tool === "pawley") {
    app.openReductions(plan.tool);
  } else if (plan.tool === "km-curve") {
    // The Statistical tests panel takes its test, columns and grouping from a request.
    const km = kaplanMeierSeed(plan.seed);
    if (km) useStatsTestsStore.getState().openWith({ testId: "kaplan-meier", selection: km.selection, params: { ...DEFAULT_PARAMS, survivalGroups: km.survivalGroups } });
    else useStatsTestsStore.getState().setOpen(true);
  } else if (plan.tool === "row-t-tests") {
    // Same panel: the recorded design, groups, variance model, adjustment, alpha and alternative come back exactly.
    const rowT = rowTSeed(plan.seed);
    if (rowT) useStatsTestsStore.getState().openWith({ testId: "row-t-tests", selection: rowT.selection, params: rowTParams(rowT, DEFAULT_PARAMS) });
    else useStatsTestsStore.getState().setOpen(true);
  } else if (plan.tool === "signal-spectrogram") {
    app.setSignalProcessingOpen(true);
  } else if (plan.tool === "spin-asymmetry") {
    app.setReflectivityOpen(true);
  } else if (EXTRAS.includes(plan.tool)) {
    useAnalysisExtras.getState().show(plan.tool as AnalysisExtra);
  }
  endSessionWhenClosed(plan.tool, () => isToolOpen(plan.tool));
  useApp.getState().setStatus(notice ?? `${replot}opened ${plan.toolLabel} with the settings of “${result.name}”`, notice ? "warn" : "ok");
  return true;
}

/** Frequency count has no panel: its prompt is refilled with the recorded settings (fail closed: no seed, no prompt). */
function reopenFrequencyCount(plan: Extract<ReopenPlan, { ok: true }>, resultName: string, notice: string | null): boolean {
  const app = useApp.getState();
  const seed = frequencyCountSeed(plan.seed);
  if (!seed || !plan.sourceId) {
    useToolReopen.getState().end(plan.tool);
    app.setStatus(`${plan.label}: ${notice ?? "its recorded settings cannot be restored"} Frequency count was not opened; run Data ▸ Frequency count again.`, "warn");
    return false;
  }
  const sourceId = plan.sourceId;
  const replaceName = plan.replaceBlocked ? null : plan.outputName;
  app.setStatus(notice ?? `opened Frequency count with the settings of “${resultName}”`, notice ? "warn" : "ok");
  void import("./worksheetStatsRun").then(
    (m) => m.runFrequencyCount({ sourceId, seed, replaceName }),
    () => { useToolReopen.getState().end(plan.tool); useApp.getState().setStatus("couldn't load Frequency count — try again", "danger"); },
  );
  return true;
}

/** The plot's FFT gadget has no panel and no editing session: reopening re-arms it (FFT mode, the recorded region on the
 *  recorded channel of the recorded source) and its "Add" makes a NEW spectrum (never a silent replace). Fail closed:
 *  settings that cannot be trusted, or a recorded channel that moved, leave the plot untouched. */
function reopenGadgetFft(plan: Extract<ReopenPlan, { ok: true }>, resultName: string, notice: string | null): boolean {
  const app = useApp.getState();
  const seed = gadgetFftSeed(plan.seed);
  const source = plan.sourceId ? app.datasets.find((dataset) => dataset.id === plan.sourceId) : undefined;
  const refuse = (why: string): boolean => {
    app.setStatus(`${plan.label}: ${why} The FFT gadget was not changed; draw the region and choose FFT again.`, "warn");
    return false;
  };
  if (!seed || !source) return refuse(notice ?? "its recorded settings cannot be restored.");
  const channels = planRecordedChannels(source, recordedChannels(plan.extra));
  if (channels.kind === "problem") return refuse(channels.problem);
  // The gadget reads its own curve (first visible plotted channel, on its own X): it must be the recorded one.
  const view = { xKey: channels.xKey, yKeys: [channels.yKey], seriesOrder: null, hiddenChannels: app.hiddenChannels };
  const curve = gadgetCurve(source, view);
  if (!curve || curve.yKey !== seed.yKey || curve.xKey !== seed.xKey) return refuse(`the recorded channel “${channels.label}” would not be the gadget's curve against the recorded X.`);
  app.setActive(source.id);
  const now = useApp.getState();
  if (now.xKey !== channels.xKey || now.yKeys?.length !== 1 || now.yKeys[0] !== channels.yKey || now.seriesOrder !== null) {
    now.recordHistory("plot the recorded Gadget FFT channel");
    useApp.setState({ xKey: channels.xKey, yKeys: [channels.yKey], seriesOrder: null });
  }
  app.setStageTab("plot");
  const gadget = useApp.getState();
  gadget.setGadgetMode("fft");
  gadget.setQfitRoi(seed.roi);
  gadget.setStatus(notice ?? `opened the FFT gadget on “${channels.label}” over the region of “${resultName}”; Add makes a new spectrum`, notice ? "warn" : "ok");
  return true;
}
