// Graph browser (gap plan item 22), state: which curve is browsed, the browse
// plans (for the buttons' enabled state), the axis scroller's windows and the
// view-filter plan. Every write is an existing path: `browseGraph` (the rebind
// path), `recordView` (view history), `setDatasetFilter` (the Data Filter).

import { useMemo, useState } from "react";

import { fixedLim } from "../../../lib/axisLim";
import { dataExtents, scrollFraction } from "../../../lib/axisScroll";
import { visibleCurves } from "../../../lib/browseGraph";
import type { RebindState } from "../../../lib/curveRebind";
import { planViewFilter } from "../../../lib/graphFilter";
import { browseGraph, planStep } from "../../../store/browseGraphApply";
import { useBrowseSettings } from "../../../store/browseSettings";
import { applyViewFilter, endAxisScroll, scrollAxisTo, scrollKindOf, type ScrollAxisName } from "../../../store/graphBrowserActions";
import { useApp } from "../../../store/useApp";

export type ScrollAxis = ScrollAxisName;

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
  const y2Lim = useApp((s) => s.y2Lim);
  const y2Scale = useApp((s) => s.y2Scale);
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

  const perStep = useBrowseSettings((s) => s.perStep);
  const group = useBrowseSettings((s) => s.group);
  // `rebind` and `group` are the plan's inputs (planStep reads the same store): re-plan when either moves.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const column = useMemo(() => planStep("column", 1, at, perStep), [rebind, group, at, perStep]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sheet = useMemo(() => planStep("sheet", 1, at, perStep), [rebind, group, at, perStep]);

  // Axis scroller: every axis scrolls in its own coordinates (linear, log10, 1/x), on the Y2 axis too,
  // and on an exchanged plot (the limits stay with the axis they belong to, only the geometry turns).
  const hasY2 = (y2Keys?.length ?? 0) > 0;
  const kinds = { xScale, yScale, y2Scale };
  const extents = useMemo(() => {
    if (!ds) return { x: null, y: null, y2: null };
    const positive = { x: xScale === "log" || xScale === "reciprocal", y: yScale === "log" || yScale === "reciprocal", y2: y2Scale === "log" || y2Scale === "reciprocal" };
    const args = [ds, xKey, yKeys, seriesOrder, hiddenChannels, y2Keys ?? [], positive] as const;
    return { ...dataExtents(...args), y2: hasY2 ? dataExtents(...args, "y2").y : null };
  }, [ds, xKey, yKeys, seriesOrder, hiddenChannels, y2Keys, hasY2, xScale, yScale, y2Scale]);
  const scroll = (axis: ScrollAxis) => {
    const lim = fixedLim(axis === "x" ? xLim : axis === "y" ? yLim : y2Lim);
    const extent = extents[axis];
    if (!lim || !extent) return { lim, fraction: null as number | null, why: "zoom in first (this axis is on auto)" };
    const fraction = scrollFraction(lim, extent, scrollKindOf(kinds, axis));
    return { lim, fraction, why: fraction === null ? "the window already covers all the data" : "" };
  };
  function scrollTo(axis: ScrollAxis, t: number): void {
    const extent = extents[axis];
    if (extent) scrollAxisTo(axis, extent, t);
  }

  const filter = useMemo(() => planViewFilter({ ...rebind, xLim, yLim }, withY), [rebind, xLim, yLim, withY]);

  return {
    ds, curveNames, slot: at, setSlot, column, sheet, step: (by: "column" | "sheet", d: 1 | -1) => void browseGraph(by, d, at),
    scroll, scrollTo, hasY2, perStep, setPerStep: useBrowseSettings.getState().setPerStep, scrollDone: endAxisScroll, filter, withY, setWithY, applyFilter: () => void applyViewFilter(filter), singleCurve: curves.length === 1,
  };
}
