// Graph browser (gap plan item 22), state: which curve is browsed, the browse
// plans (for the buttons' enabled state), the axis scroller's windows and the
// view-filter plan. Every write is an existing path: `browseGraph` (the rebind
// path), `recordView` (view history), `setDatasetFilter` (the Data Filter).

import { useMemo, useState } from "react";

import { fixedLim } from "../../../lib/axisLim";
import { dataExtents, scrollFraction } from "../../../lib/axisScroll";
import { planBrowse, visibleCurves } from "../../../lib/browseGraph";
import type { RebindState } from "../../../lib/curveRebind";
import { planViewFilter } from "../../../lib/graphFilter";
import { browseGraph } from "../../../store/browseGraphApply";
import { applyViewFilter, endAxisScroll, scrollAxisTo } from "../../../store/graphBrowserActions";
import { useApp } from "../../../store/useApp";

export type ScrollAxis = "x" | "y";

export function useGraphBrowser() {
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const hiddenChannels = useApp((s) => s.hiddenChannels);
  const seriesLabels = useApp((s) => s.seriesLabels);
  const workbooks = useApp((s) => s.workbooks);
  const xLim = useApp((s) => s.xLim);
  const yLim = useApp((s) => s.yLim);
  const y2Keys = useApp((s) => s.y2Keys);
  const xScale = useApp((s) => s.xScale);
  const yScale = useApp((s) => s.yScale);
  const exchanged = useApp((s) => s.exchangeXY);
  const [slot, setSlot] = useState(0);
  const [withY, setWithY] = useState(false);

  const rebind = useMemo<RebindState>(
    () => ({ datasets, activeId, xKey, yKeys, seriesOrder, hiddenChannels, seriesLabels, workbooks }),
    [datasets, activeId, xKey, yKeys, seriesOrder, hiddenChannels, seriesLabels, workbooks],
  );
  const ds = datasets.find((d) => d.id === activeId) ?? null;
  const curves = useMemo(() => visibleCurves(rebind), [rebind]);
  // The chosen place survives a graph with fewer curves by falling back to the first.
  const at = slot < curves.length ? slot : 0;
  const curveNames = curves.map((c, i) => ({ slot: i, label: ds?.data.labels[c] || `curve ${i + 1}` }));

  const column = useMemo(() => planBrowse(rebind, "column", 1, at), [rebind, at]);
  const sheet = useMemo(() => planBrowse(rebind, "sheet", 1, at), [rebind, at]);

  // Axis scroller: linear and log axes (log scrolls in log space), not reciprocal or exchanged ones.
  const extents = useMemo(
    () => (ds ? dataExtents(ds, xKey, yKeys, seriesOrder, hiddenChannels, y2Keys ?? [], { x: xScale === "log", y: yScale === "log" }) : { x: null, y: null }),
    [ds, xKey, yKeys, seriesOrder, hiddenChannels, y2Keys, xScale, yScale],
  );
  const scroll = (axis: ScrollAxis) => {
    const lim = fixedLim(axis === "x" ? xLim : yLim);
    const extent = axis === "x" ? extents.x : extents.y;
    const kind = axis === "x" ? xScale : yScale;
    const linear = (kind === "linear" || kind === "log") && !exchanged;
    if (!lim || !extent || !linear) return { lim, fraction: null as number | null, why: !linear ? "needs a linear or log axis" : "zoom in first (this axis is on auto)" };
    const fraction = scrollFraction(lim, extent, kind === "log");
    return { lim, fraction, why: fraction === null ? "the window already covers all the data" : "" };
  };
  function scrollTo(axis: ScrollAxis, t: number): void {
    const extent = axis === "x" ? extents.x : extents.y;
    if (extent) scrollAxisTo(axis, extent, t);
  }

  const filter = useMemo(() => planViewFilter({ ...rebind, xLim, yLim }, withY), [rebind, xLim, yLim, withY]);

  return {
    ds, curveNames, slot: at, setSlot, column, sheet, step: (by: "column" | "sheet", d: 1 | -1) => void browseGraph(by, d, at),
    scroll, scrollTo, scrollDone: endAxisScroll, filter, withY, setWithY, applyFilter: () => void applyViewFilter(filter), singleCurve: curves.length === 1,
  };
}
