// Column-removal remap for the two index-keyed holders `lib/channelRemap.ts`
// does not cover: a legacy publication FigureDoc's `config` and a saved Graph
// Builder `PlotSpec`. Both name columns by plain index; a live doc re-renders
// from current data and a saved spec is re-resolved on open, so a removed
// column left either plotting whatever slid into the old slot (or an
// out-of-range index). Same rules as `channelRemap.ts`: shift what survives,
// drop what was the removed column. Pure — no store import.

import { remapChannel, remapChannelList, remapErrorRoles } from "./channelRemap";
import type { FigureConfig } from "./figuredoc";
import type { ChannelRef, PlotSpec, PlotZones } from "./plotspec";

/** Remap a legacy `FigureConfig`. `seriesStyles` is POSITIONAL against the
 *  plotted channels (`yKeys ?? every column`), so the removed column's entry
 *  is spliced out with it — otherwise each later series inherits its
 *  neighbour's style. */
export function remapLegacyFigureConfig(c: FigureConfig, removedCol: number): FigureConfig {
  const pos = c.yKeys ? c.yKeys.indexOf(removedCol) : removedCol;
  const seriesStyles = c.seriesStyles && pos >= 0 ? c.seriesStyles.filter((_, i) => i !== pos) : c.seriesStyles;
  return {
    ...c,
    xKey: c.xKey === null ? null : remapChannel(c.xKey, removedCol),
    yKeys: c.yKeys === null ? null : remapChannelList(c.yKeys, removedCol),
    groupCol: c.groupCol == null ? c.groupCol : remapChannel(c.groupCol, removedCol),
    errors: c.errors && remapErrorRoles(c.errors, removedCol),
    seriesStyles,
  };
}

/** Remap every zone of `spec` that targets `datasetId`; returns `spec` itself
 *  when nothing points there. A text-column pick (`channel < 0`) is by name and
 *  stays. `yErr` is position-paired with `y`, so it is cut at the first pair
 *  that loses either end — a later error never slides onto a different Y. */
export function remapPlotSpecRefs(spec: PlotSpec, datasetId: string, removedCol: number): PlotSpec {
  const z = spec.zones;
  if (!Object.values(z).flat().some((r) => r?.datasetId === datasetId)) return spec;
  const one = (r: ChannelRef | null): ChannelRef | null => {
    const c = r && r.datasetId === datasetId && r.channel >= 0 ? remapChannel(r.channel, removedCol) : -1;
    return c === -1 ? r : c === null ? null : { ...r!, channel: c };
  };
  // The first pair to lose either end; every error from there on is dropped.
  const cut = z.y.findIndex((r, i) => !one(r) || (i < z.yErr.length && !one(z.yErr[i])));
  const zones = Object.fromEntries(
    Object.entries(z).map(([k, v]: [string, ChannelRef | ChannelRef[] | null]) => [
      k,
      Array.isArray(v) ? (k === "yErr" && cut >= 0 ? v.slice(0, cut) : v).map(one).filter((r) => r) : one(v),
    ]),
  ) as unknown as PlotZones;
  return { ...spec, zones };
}
