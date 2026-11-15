// The export half of the live plot's per-series X (lib/perSeriesX.ts, origin
// gap audit 2 #2): a figure request for a sheet whose Ys belong to different X
// columns is built from the SAME segment-concatenated view the canvas draws,
// so the exported R1 sits on T1 and R2 on T2 exactly as on screen. The plotted
// channel list is resolved the way the canvas resolves it (usePlotPayload's
// `fetchChannels`: the view's data, the view's former X excluded), then the
// view's X (`.time`) becomes the request's X.

import { perSeriesXData, perSeriesXDataset } from "./perSeriesX";
import { effectiveChannels } from "./plotdata";
import type { PlotView } from "./plotview";
import type { Dataset, DataStruct } from "./types";

export function perSeriesXSpec<E extends { liveDataset?: Dataset | null }>(
  st: PlotView,
  data: DataStruct,
  channelRoles: Dataset["channelRoles"] | undefined,
  extras: E,
): [PlotView, DataStruct, E] {
  const live = extras.liveDataset ?? null;
  // The export drops hidden channels (figureSpec), so only the shown ones decide the blocks.
  const shown = effectiveChannels(data, st.yKeys, st.xKey, channelRoles).filter((c) => !st.hiddenChannels.includes(c));
  const v = perSeriesXData({ data, columnDesignations: live?.columnDesignations }, st.xKey, shown);
  if (!v) return [st, data, extras];
  const yKeys = effectiveChannels(v.data, st.yKeys, st.xKey, channelRoles);
  const liveView = live ? (perSeriesXDataset(live, st.xKey, shown)?.dataset ?? null) : live;
  return [{ ...st, xKey: null, yKeys }, v.data, { ...extras, liveDataset: liveView }];
}
