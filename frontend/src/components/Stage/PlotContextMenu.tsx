// Right-click context menu for the focused plot canvas (the owner's ask:
// "edit plots imported from Origin without hunting the Inspector"). Wires the
// pure hit-test (lib/plotHitTest) + menu-spec builder (lib/plotMenu) to the live
// uPlot instance and the store: it reads pixel positions off the instance to
// find the nearest curve + the axis zone under the cursor, builds a context
// object of EXISTING store actions, and renders <ContextMenu>. Origin-imported
// and native plots share every store field, so both edit identically here.

import { type RefObject, useMemo } from "react";
import type uPlot from "uplot";

import type { PlotPayload } from "../../lib/plotdata";
import { axisZoneAt, type AxisZone, nearestIndex, pickNearestSeries } from "../../lib/plotHitTest";
import { buildPlotMenu, type LegendCorner, type MenuSeries } from "../../lib/plotMenu";
import type { MarkerShape } from "../../lib/types";
import { useApp } from "../../store/useApp";
import ContextMenu from "../overlays/ContextMenu";
import { askParams } from "../overlays/ParamDialog";
import type { PlotStageActions } from "./usePlotStageActions";

// A right-click further than this (px) from every curve shows axis/plot entries
// only — no spurious "nearest series" header for a click in empty plot space.
const HIT_PX = 44;

interface Props {
  /** Client coords of the right-click (the menu anchor). */
  x: number;
  y: number;
  plotRef: RefObject<uPlot | null>;
  payload: PlotPayload;
  /** Dataset channel index for each plotted display-series (overlays excluded). */
  plotted: number[];
  /** Visibility per display-series (true = hidden), 1:1 with payload.series. */
  hidden?: boolean[];
  actions: PlotStageActions;
  onClose: () => void;
}

/** Hit-test the cursor against the live plot: the nearest visible curve (within
 *  HIT_PX) and which axis zone the cursor sits in. */
function hitTest(
  u: uPlot | null,
  x: number,
  y: number,
  plotted: number[],
  hidden: boolean[] | undefined,
  hasY2: boolean,
): { series: number | null; idx: number | null; zone: AxisZone } {
  if (!u || !u.over) return { series: null, idx: null, zone: "outside" };
  const rect = u.over.getBoundingClientRect();
  const zone = axisZoneAt(
    x,
    y,
    { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    hasY2,
  );
  const localX = x - rect.left;
  const localY = y - rect.top;
  const xData = (u.data[0] ?? []) as (number | null)[];
  const idx = nearestIndex(xData, u.posToVal(localX, "x"));
  if (idx == null) return { series: null, idx: null, zone };
  // Pixel-y of each visible display-series at the probe index (through its own
  // scale, so primary + secondary series compare fairly). Hidden → null.
  const seriesPy: (number | null)[] = plotted.map((_, i) => {
    if (hidden?.[i]) return null;
    const col = u.data[i + 1] as (number | null)[] | undefined;
    const yv = col?.[idx];
    if (yv == null || Number.isNaN(yv)) return null;
    const scale = u.series[i + 1]?.scale ?? "y";
    return u.valToPos(yv, scale, false);
  });
  return { series: pickNearestSeries(localY, seriesPy, HIT_PX), idx, zone };
}

export default function PlotContextMenu({ x, y, plotRef, payload, plotted, hidden, actions, onClose }: Props) {
  const items = useMemo(() => {
    // Snapshot the store at open time — the menu is single-shot (every action
    // calls onClose), so it never needs to react to later store changes.
    const st = useApp.getState();
    const u = plotRef.current;
    const hasY2 = (st.y2Keys?.length ?? 0) > 0;
    const { series: nearIdx, zone } = hitTest(u, x, y, plotted, hidden, hasY2);

    // Resolve the hit-tested series into the menu-spec shape.
    let series: MenuSeries | null = null;
    if (nearIdx != null) {
      const channel = plotted[nearIdx];
      const spec = payload.series[nearIdx];
      const def = spec?.unit ? `${spec.label} (${spec.unit})` : (spec?.label ?? `series ${channel}`);
      series = {
        channel,
        label: st.seriesLabels[channel] ?? def,
        style: st.seriesStyles[channel] ?? {},
        hidden: st.hiddenChannels.includes(channel),
        onY2: (st.y2Keys ?? []).includes(channel),
      };
    }
    const visibleCount = plotted.filter((c) => !st.hiddenChannels.includes(c)).length;

    // Move a channel between the primary and secondary Y axis (PlotLegend's rule).
    const toggleY2 = (channel: number) => {
      const set = new Set(st.y2Keys ?? []);
      if (set.has(channel)) set.delete(channel);
      else set.add(channel);
      st.setY2Keys(set.size ? [...set] : null);
    };
    const rename = (channel: number) => {
      void askParams("Rename series", [
        { key: "label", label: "Label", type: "text", default: st.seriesLabels[channel] ?? series?.label ?? "" },
      ]).then((v) => {
        if (v) st.setSeriesLabel(channel, String(v.label));
      });
    };
    // Set-limits dialog seeded from the current manual range or the live scale.
    const editLimits = (
      scaleKey: string,
      cur: [number, number] | null,
      setter: (lim: [number, number] | null) => void,
    ) => {
      const sc = plotRef.current?.scales?.[scaleKey];
      const min = cur?.[0] ?? sc?.min ?? 0;
      const max = cur?.[1] ?? sc?.max ?? 1;
      void askParams("Set axis limits", [
        { key: "min", label: "Min", type: "number", default: min },
        { key: "max", label: "Max", type: "number", default: max },
      ]).then((v) => {
        if (!v) return;
        const lo = Number(v.min);
        const hi = Number(v.max);
        if (Number.isFinite(lo) && Number.isFinite(hi) && lo !== hi) setter([Math.min(lo, hi), Math.max(lo, hi)]);
      });
    };
    const y2ScaleEff = st.y2Scale ?? st.yScale;

    return buildPlotMenu({
      series,
      zone,
      hasY2,
      canHide: visibleCount > 1,
      xScale: st.xScale,
      yScale: st.yScale,
      y2Scale: y2ScaleEff,
      showGrid: st.showGrid,
      showLegend: st.showLegend,
      legendPos: st.legendPos as LegendCorner,
      setColor: (ch, color) => st.setSeriesStyle(ch, { color }),
      setLine: (ch, line) => st.setSeriesStyle(ch, { line }),
      setWidth: (ch, width) => st.setSeriesStyle(ch, { width }),
      setMarker: (ch, marker, shape?: MarkerShape) =>
        st.setSeriesStyle(ch, { marker, ...(shape ? { markerShape: shape } : {}) }),
      resetStyle: st.resetSeriesStyle,
      toggleHidden: st.toggleHidden,
      rename,
      toggleY2,
      setXScale: st.setXScale,
      setYScale: st.setYScale,
      setY2Scale: st.setY2Scale,
      autoscaleX: () => st.setXLim(null),
      autoscaleY: () => st.setYLim(null),
      autoscaleY2: () => st.setY2Lim(null),
      limitsX: () => editLimits("x", st.xLim, st.setXLim),
      limitsY: () => editLimits("y", st.yLim, st.setYLim),
      limitsY2: () => editLimits("y2", st.y2Lim, st.setY2Lim),
      setShowGrid: st.setShowGrid,
      setShowLegend: st.setShowLegend,
      setLegendPos: (pos) => st.setLegendPos(pos),
      resetView: actions.resetView,
      copyImage: actions.snapshot,
      savePng: actions.savePng,
      copyData: actions.copyData,
      setTool: st.setPlotTool,
    });
    // Single-shot menu (every action calls onClose): rebuild only if the anchor
    // moves. The store snapshot is captured at open time — correct because a
    // pick immediately closes the menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}
