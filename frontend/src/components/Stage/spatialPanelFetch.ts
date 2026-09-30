// One spatial Origin panel's fetched series plus its error bars, for
// `useMultiPanelStage`'s spatial mode. Extracted from that hook (a pinned
// module) so it could take on F4.2c (a): each panel draws its dataset's
// excluded and filter-dropped rows as every other plot does, following the
// app-wide "Excluded rows" mode (`plotdata.maskExcludedPayload`: hidden, or
// kept as muted "(excluded)" companions). It used to draw them as ordinary
// data while "Export page…" left them out; the export now asks greyed or
// omitted (`lib/exportPageCommand.ts`), so the page shows what it exports.

import { resolveSecondaryAxis, secondaryAxisFromPanel } from "../../lib/axisspec";
import { buildErrorColumns } from "../../lib/errorbars";
import { spatialPlottedChannels, type SpatialPanel } from "../../lib/multipanel";
import {
  DECIMATE_MIN_POINTS,
  decimationRequestEligible,
  defaultDecimateWidthHint,
  errorBindingsApplyToPlotted,
} from "../../lib/plotDecimate";
import { fetchPlot, maskExcludedPayload, type PlotPayload } from "../../lib/plotdata";
import { droppedRows } from "../../lib/rowstate";
import type { Dataset, DefaultTrace } from "../../lib/types";
import type { ExcludedDisplay } from "../../store/useApp";

/** One spatial panel's fetched series plus its own error-bar map (built at
 *  fetch time — needs the panel's full DataStruct, not just the plotted
 *  payload). */
export interface SpatialFetch {
  payload: PlotPayload;
  errorBars: Map<number, (number | null)[]>;
}

/** Fetch panel `p` over its own dataset `ds` (the caller triggers a lazy
 *  book's full-data fetch). */
export async function fetchSpatialPanel(
  p: SpatialPanel,
  ds: Dataset,
  defaultTrace: DefaultTrace | undefined,
  excludedDisplay: ExcludedDisplay,
): Promise<SpatialFetch> {
  // Item A (PNR.opj Book14 Graph11 repro): drop this panel's Origin-
  // hidden channels (a "Y-error" column like dSA) from what's actually
  // fetched/plotted — the spatial grid's decoded legend is static and
  // cannot keep them toggle-able, unlike the single-plot path (see
  // `multipanel.spatialPlottedChannels`'s doc). y2Keys is filtered the
  // same way for consistency, though a hidden channel is never itself
  // curve-bound to y2 in practice.
  const plottedChannels = spatialPlottedChannels(p);
  // #54 pass B: the plotted∩y2 intersection comes from the shared
  // resolver, the same one both export paths use — `y2_keys` is a set
  // membership marker on the wire (lib/plotdata's `new Set(y2Keys)`),
  // so this is the identical selection expressed once instead of thrice.
  const y2 =
    resolveSecondaryAxis(plottedChannels, secondaryAxisFromPanel(p), {
      scale: p.yLog ? "log" : "linear",
      fmt: { mode: "auto", digits: 2 },
    })?.keys ?? null;
  // The mask indexes dataset rows, so a panel with dropped rows is never
  // server-decimated (a bucketed payload's rows are not the dataset's).
  const dropped = droppedRows(ds);
  // A panel carrying a merged y2 overlay (decode-plan #36 residual —
  // `originFigures.resolveSpatialPanels`) passes its OWN y2Keys so the
  // fetched payload tags those series `axis: 1`, same as the single-
  // plot double-Y apply.
  // P3.4: same size/error-bar/scatter gate as the plain-stack fetch,
  // evaluated per-panel (each panel owns its own dataset + err
  // bindings). No overlay-companion concept here either.
  const panelDecimateWidth =
    dropped.size === 0 &&
    ds.data.time.length > DECIMATE_MIN_POINTS &&
    decimationRequestEligible({
      defaultTrace,
      hasErrorBars: Object.keys(p.errKeys ?? {}).length > 0,
      hasErrorSpans: errorBindingsApplyToPlotted(ds.errorRoles, plottedChannels, { xErrorRenders: false }),
      hasColorByColumns: false,
    })
      ? defaultDecimateWidthHint()
      : null;
  const fetched = await fetchPlot(ds.data, p.yLog, p.xLog, plottedChannels, y2, p.xKey, panelDecimateWidth);
  return {
    payload: maskExcludedPayload(fetched, dropped, excludedDisplay),
    // Error-bar magnitudes for THIS panel's own dataset/designations
    // (`originFigures.figureChannelSelection` populated `p.errKeys`),
    // keyed to the SAME plottedChannels order the payload's series
    // are in.
    errorBars: buildErrorColumns(ds.data, plottedChannels, p.errKeys ?? {}),
  };
}
