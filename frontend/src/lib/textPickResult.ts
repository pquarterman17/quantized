// A saved Fit Y by X / Variability result names its columns by channel index. A pick of a CSV text
// column (lib/groupableColumns appends those after the sheet's real channels) is such an index too, so it
// is only as stable as the sheet's text columns. The result also records each picked column's LABEL
// (`selection.channels`), and a text-column pick is honoured only while that label is still the one at the
// index: a reordered or renamed text column makes the result decline to reopen, never regroup by
// another column. A release that predates text-column picks bounds the recipe by the real channel count
// and declines the same way (`fitYByXRecipe` / `variabilityRecipe` return null).

import type { AnalysisResult } from "./analysisResult";
import { withTextGroupChannels } from "./groupableColumns";
import type { Dataset } from "./types";

/** True when every pick that names a text column still names the column the result recorded for it. */
export function textPicksHold(result: AnalysisResult, source: Dataset, picks: readonly (number | null)[]): boolean {
  const width = source.data.labels.length;
  const labels = withTextGroupChannels(source).data.labels;
  const recorded = result.selection?.channels ?? [];
  return picks.every((pick) => pick === null || pick < width
    || recorded.some((channel) => channel.index === pick && channel.label === labels[pick]));
}
