// The export leg of the live plot's per-series X (Origin-gap audit 2, #2):
// `buildFigureSpecForView` (lib/figureSpec.ts) runs its inputs through this
// first, so a PDF/SVG draws each Y against its OWN X exactly as the canvas
// does (`Stage/usePerSeriesXView.ts` -> `lib/perSeriesX.ts`, the one
// planner both legs share). With a live dataset the view also carries its
// row state (excluded/filtered rows, once per block); a frozen or
// document-only call still honours the dataset's own "Set As" designations
// when the caller passes them, so export == screen either way.

import type { ColumnDesignations } from "./columnmeta";
import type { ErrorBinding } from "./errorRoles";
import { withLinkedLegends } from "./linkedLegends";
import { perSeriesXPlan } from "./perSeriesX";
import { effectiveChannels } from "./plotdata";
import type { PlotView } from "./plotview";
import type { Dataset, DataStruct } from "./types";

interface SeriesXExtras {
  liveDataset?: Dataset | null;
  /** The dataset's own designations when no live dataset rides along. */
  columnDesignations?: ColumnDesignations;
}

/** `st`/`data`/`extras` re-pointed at the per-series-X view (unchanged when
 *  every shown curve already shares the plot's X). */
export function withPerSeriesX<E extends SeriesXExtras>(
  st: PlotView,
  data: DataStruct,
  channelRoles: Dataset["channelRoles"] | undefined,
  errors: readonly ErrorBinding[] | undefined,
  extras: E,
): { st: PlotView; data: DataStruct; extras: E } {
  // A live graph's curve names are its legend defaults (lib/linkedLegends.ts).
  const labels = withLinkedLegends(data, st.seriesLabels);
  if (labels !== st.seriesLabels) st = { ...st, seriesLabels: labels };
  const live = extras.liveDataset;
  const ds: Dataset = live
    ? { ...live, data, errorRoles: errors ? [...errors] : live.errorRoles }
    : { id: "", name: "", data, channelRoles, columnDesignations: extras.columnDesignations, errorRoles: errors ? [...errors] : undefined };
  const plotted = effectiveChannels(data, st.yKeys, st.xKey, channelRoles, st.seriesOrder);
  const plan = perSeriesXPlan(ds, st.xKey, plotted.filter((c) => !st.hiddenChannels.includes(c)));
  if (plan.xKey === st.xKey && !plan.view) return { st, data, extras };
  const view = plan.view;
  return {
    st: { ...st, xKey: plan.xKey, yKeys: plotted },
    data: view ? view.dataset.data : data,
    extras: live && view ? { ...extras, liveDataset: view.dataset } : extras,
  };
}
