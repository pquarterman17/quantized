// "Open in <tool>" for a committed analysis output (lane RO): reopen the
// producing tool on the RECORDED source with the RECORDED settings, as an
// editing session (store/toolReopen.ts) whose commit replaces the old output
// in one undo step, or adds a new one. Lazy (reached from the result workspace
// and the Library's result menu only).
//
// Fail closed: the plan (lib/committedOutputReopen.ts) decides; a refused plan
// opens nothing and says why. A missing source still opens the tool, but with a
// notice and no settings, and never on a silently different worksheet's data.

import { planReopen } from "../lib/committedOutputReopen";
import { DEFAULT_PARAMS } from "../lib/statsTests";
import { kaplanMeierSeed } from "../lib/kaplanMeierReopenSeed";
import { useAnalysisExtras, type AnalysisExtra } from "./analysisExtras";
import { useStatsTestsStore } from "./statsTests";
import { useToolReopen } from "./toolReopen";
import { planRecordedChannels, recordedChannels } from "./toolReopenChannels";
import { guardRecordedPicks } from "./toolReopenPicks";
import { endSessionWhenClosed } from "./toolReopenWatch";
import { useApp } from "./useApp";

const EXTRAS: readonly string[] = ["surface-fit", "optical-gap", "ellipse-fit"] satisfies AnalysisExtra[];

/** Tools that run on the ACTIVE dataset's plotted X/Y (the batch tools in every picked dataset; the Magnetometry tabs): reopening plots the recorded channels. */
const CHANNEL_TOOLS: readonly string[] = ["peak-batch", "peak-batch-integrate", "mag-normalization", "mag-demag", "curie-weiss"];

/** Whether each tool is open (the session ends when it closes: lane RO2). */
const isToolOpen = (tool: string): boolean => {
  const app = useApp.getState();
  switch (tool) {
    case "baseline-subtract": return app.baselineOpen;
    case "tabulate": return app.tabulateOpen;
    case "peak-batch": return app.peakWizardOpen;
    case "peak-batch-integrate": return app.peaksOpen;
    case "spin-asymmetry": return app.reflectivityOpen;
    case "mag-normalization": case "mag-demag": case "curie-weiss": return app.magToolsOpen;
    case "fit-band": return app.curveFitOpen;
    case "fft-thickness": case "reflectivity-fft": case "pawley": return app.reductionsOpen;
    case "km-curve": return useStatsTestsStore.getState().open;
    default: return useAnalysisExtras.getState().open.includes(tool as AnalysisExtra);
  }
};

/** True when the tool opened (with or without the recorded settings). */
export function openCommittedResultInTool(resultId: string): boolean {
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
  const plan = guardRecordedPicks(planned, planned.sourceId ? app.datasets.find((dataset) => dataset.id === planned.sourceId) : undefined);
  // A batch tool runs on the plotted channels: plot the recorded ones, or say they moved.
  const source = plan.sourceId ? app.datasets.find((dataset) => dataset.id === plan.sourceId) : undefined;
  const channels = CHANNEL_TOOLS.includes(plan.tool) && source && plan.seed
    ? planRecordedChannels(source, recordedChannels(plan.extra)) : null;
  const fitBand = plan.tool === "fit-band" && plan.seed ? `Curve Fit opens with this band's level and prediction setting; fit “${String(plan.seed["model"])}” on this worksheet again. Replace is available only while the live fit matches the one this band was drawn from.` : null;
  const notice = [plan.notice, channels?.kind === "problem" ? channels.problem : null, fitBand].filter(Boolean).join(" ") || null;
  useToolReopen.getState().start(plan.tool, {
    resultId: result.id, resultName: result.name, sourceId: plan.sourceId, sourceIds: plan.sourceIds, outputId: plan.outputId,
    outputName: plan.outputName, seed: plan.seed, extra: plan.extra, notice, replaceBlocked: plan.replaceBlocked,
  });
  if (plan.sourceId) app.setActive(plan.sourceId);
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
  } else if (plan.tool === "peak-batch-integrate") {
    app.setPeaksOpen(true);
  } else if (plan.tool === "mag-normalization" || plan.tool === "mag-demag" || plan.tool === "curie-weiss") {
    app.setMagToolsOpen(true);
  } else if (plan.tool === "fit-band") {
    app.setCurveFitOpen(true);
  } else if (plan.tool === "fft-thickness" || plan.tool === "reflectivity-fft" || plan.tool === "pawley") {
    app.openReductions(plan.tool);
  } else if (plan.tool === "km-curve") {
    // The Statistical tests panel takes its test, columns and grouping from a request.
    const km = kaplanMeierSeed(plan.seed);
    if (km) useStatsTestsStore.getState().openWith({ testId: "kaplan-meier", selection: km.selection, params: { ...DEFAULT_PARAMS, survivalGroups: km.survivalGroups } });
    else useStatsTestsStore.getState().setOpen(true);
  } else if (plan.tool === "spin-asymmetry") {
    app.setReflectivityOpen(true);
  } else if (EXTRAS.includes(plan.tool)) {
    useAnalysisExtras.getState().show(plan.tool as AnalysisExtra);
  }
  endSessionWhenClosed(plan.tool, () => isToolOpen(plan.tool));
  useApp.getState().setStatus(notice ?? `${replot}opened ${plan.toolLabel} with the settings of “${result.name}”`, notice ? "warn" : "ok");
  return true;
}
