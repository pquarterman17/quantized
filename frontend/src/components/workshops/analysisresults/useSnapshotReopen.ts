// "Reopen in tool" for a saved snapshot result (extracted from
// AnalysisResultPanel; the Time series, DOE and Profiler kinds added, owner
// decision 2026-11-25): parse the result's saved recipe (null = not
// reopenable, fail closed) and hand it to its tool's request store. Each tool
// then restores the recorded settings on the recorded source.

import type { AnalysisResult } from "../../../lib/analysisResult";
import { distributionRecipe } from "../../../lib/distributionAnalysisResult";
import { fitModelRecipe } from "../../../lib/fitModelRecipe";
import { fitYByXRecipe } from "../../../lib/fitYByXAnalysisResult";
import { withTextGroupChannels } from "../../../lib/groupableColumns";
import { textPicksHold } from "../../../lib/textPickResult";
import { multivariateRecipe } from "../../../lib/multivariateAnalysisResult";
import { outlierScreeningRecipe } from "../../../lib/outlierScreeningAnalysisResult";
import { statisticalTestRecipe } from "../../../lib/statisticalTestAnalysisResult";
import { testColumns } from "../../../lib/statsTests";
import { clusterRecipe, doeDesignRecipe, doeEffectsRecipe, profilerRecipe, timeSeriesRecipe } from "../../../lib/toolResultKinds";
import type { Dataset } from "../../../lib/types";
import { variabilityRecipe } from "../../../lib/variabilityAnalysisResult";
import { williamsonHallRecipe } from "../../../lib/williamsonHallRecipe";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useDistributionRequestStore } from "../../../store/distribution";
import { useDoeStore } from "../../../store/doe";
import { useFitModelStore } from "../../../store/fitModel";
import { useFitYByXStore } from "../../../store/fitYByX";
import { useMultivarStore } from "../../../store/multivar";
import { useOutlierScreeningStore } from "../../../store/outlierScreening";
import { useProfilerStore } from "../../../store/profiler";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useToolResultRequest } from "../../../store/toolResultRequest";
import { useApp } from "../../../store/useApp";
import { useVariabilityStore } from "../../../store/variability";
import { useWilliamsonHallRequestStore } from "../../../store/williamsonHall";

/** The tool opener for a saved result, or null when its recipe does not parse
 *  (or names a column the live source no longer has). */
export function snapshotReopener(
  result: AnalysisResult | undefined, source: Dataset | undefined, openReductions: (tab: "williamson-hall") => void,
): (() => void) | null {
  if (!result) return null;
  const stats = statisticalTestRecipe(result);
  // A pick of a CSV text column reopens only while that column is still there under its label (lib/textPickResult).
  if (stats && (!source || textPicksHold(result, source, testColumns(stats.testId, stats.selection, stats.params)))) {
    return () => useStatsTestsStore.getState().openWith(stats);
  }
  const distribution = distributionRecipe(result, source);
  if (distribution) return () => { useDistributionRequestStore.getState().openWith(distribution); useApp.setState({ distributionOpen: true }); };
  // A pick may name a CSV text column (an index past the real channels), see lib/textPickResult.
  const grouped = source ? withTextGroupChannels(source) : source;
  const holds = (picks: readonly (number | null)[]) => !source || textPicksHold(result, source, picks);
  const fitYByXPicks = fitYByXRecipe(result, grouped);
  const fitYByX = fitYByXPicks && holds([fitYByXPicks.xCol, fitYByXPicks.yCol, fitYByXPicks.byCol]) ? fitYByXPicks : null;
  if (fitYByX) return () => useFitYByXStore.getState().openWith(fitYByX);
  const variabilityPicks = variabilityRecipe(result, grouped);
  const variability = variabilityPicks && holds([variabilityPicks.responseCol, variabilityPicks.factorACol, variabilityPicks.factorBCol]) ? variabilityPicks : null;
  if (variability) return () => useVariabilityStore.getState().openWith(variability);
  const fitModel = fitModelRecipe(result, source);
  if (fitModel) return () => useFitModelStore.getState().openWith(fitModel);
  const outlier = outlierScreeningRecipe(result, source);
  if (outlier) return () => useOutlierScreeningStore.getState().openWith(outlier);
  const multivariate = multivariateRecipe(result, source);
  if (multivariate) return () => useMultivarStore.getState().openWith(multivariate);
  const wh = williamsonHallRecipe(result);
  if (wh) return () => { useWilliamsonHallRequestStore.getState().openWith(wh); openReductions("williamson-hall"); };
  const ts = timeSeriesRecipe(result, source);
  if (ts) return () => { useToolResultRequest.getState().request({ timeSeries: ts }); useAnalysisExtras.getState().show("time-series"); };
  const design = doeDesignRecipe(result);
  if (design) return () => { useToolResultRequest.getState().request({ doe: design }); useDoeStore.getState().setOpen(true); };
  if (doeEffectsRecipe(result)) return () => useDoeStore.getState().setOpen(true);
  const profile = profilerRecipe(result);
  if (profile) return () => { useToolResultRequest.getState().request({ profiler: profile }); useProfilerStore.getState().setOpen(true); };
  const cluster = clusterRecipe(result, source);
  if (cluster) return () => {
    useToolResultRequest.getState().request({ cluster });
    useMultivarStore.getState().openTab({ tab: "cluster", cluster: cluster.tool });
  };
  return null;
}
