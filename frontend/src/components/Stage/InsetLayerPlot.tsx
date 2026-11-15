// An inset GRAPH layer's own plot (origin gap audit 3 #15): a small uPlot of
// the layer's curves — any datasets' columns, read live — on its own axes.
// Range, tick positions and tick text come from `lib/graphLayers.resolveAxis`,
// the same values the export draws (`calc/figure_layers.py`), so the two never
// pick ticks or autoscale differently. Curves are laid out as the live graph
// lays them (one block of rows per curve, gaps elsewhere), so a hysteresis
// loop keeps its row order. With no curve left (every source gone) it shows
// the live graph's "sources are missing" notice instead — never a rebound
// curve. Static: no zoom or cursor; the box around it moves and resizes it.

import { useEffect, useMemo, useRef, type RefObject } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import { EMPTY_INSET_HINT, insetNotice, resolveInsetAxes, resolveInsetCurves, type InsetLayer, type ResolvedAxis } from "../../lib/graphLayers";
import { layerCurveColor } from "../../lib/graphLayersWire";
import type { PlotPayload } from "../../lib/plotdata";
import type { Dataset, SeriesStyle } from "../../lib/types";
import type { PlotBg } from "../../lib/plotview";
import { buildOpts, resolvePlotBg } from "../../lib/uplotOpts";
import { LINEAR_PATHS, POINTS_PATHS } from "../../lib/uplotPaths";
import { useApp } from "../../store/useApp";

/** Tick text size (px): the export's 7 pt. */
const TICK_PX = 9;

function payloadOf(layer: InsetLayer, datasets: readonly Dataset[]) {
  const curves = resolveInsetCurves(layer, datasets);
  const axes = resolveInsetAxes(layer, curves);
  const total = curves.reduce((n, c) => n + c.x.length, 0);
  const xs: (number | null)[] = [];
  const cols = curves.map(() => new Array<number | null>(total).fill(null));
  curves.forEach((c, i) => {
    c.x.forEach((x, r) => {
      cols[i][xs.length] = c.y[r];
      xs.push(x);
    });
  });
  const payload: PlotPayload = {
    data: [xs, ...cols] as uPlot.AlignedData,
    series: curves.map(() => ({ label: "", unit: "" })),
    xLabel: "",
    xUnit: "",
  };
  const styles: SeriesStyle[] = curves.map((c) => ({
    color: layerCurveColor(c.slot),
    width: layer.mark === "scatter" ? 0 : 1.5,
    marker: layer.mark !== "line",
  }));
  return { payload, styles, axes, notice: insetNotice(layer, curves) };
}

function fixAxis(ax: uPlot.Axis | undefined, a: ResolvedAxis): uPlot.Axis {
  return { ...ax, splits: () => a.ticks, values: () => a.labels, filter: (_u, splits) => splits, label: a.label || undefined };
}

export default function InsetLayerPlot({
  layer,
  datasets,
  areaRef,
  bg,
}: {
  layer: InsetLayer;
  datasets: readonly Dataset[];
  /** Set to the plot area (uPlot's `over`) once drawn: the box places it on `at`. */
  areaRef: RefObject<HTMLElement | null>;
  /** The plot window's background: the inset's plot area is filled with it. */
  bg?: PlotBg;
}) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const hostRef = useRef<HTMLDivElement>(null);
  const built = useMemo(() => payloadOf(layer, datasets), [layer, datasets]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || built.notice !== null) return;
    const { payload, styles, axes } = built;
    const w = host.clientWidth || 200;
    const h = host.clientHeight || 120;
    const opts = buildOpts(payload, {
      bg,
      width: w,
      height: h,
      xScale: axes.x.scale,
      yScale: axes.y.scale,
      xLim: axes.x.range,
      yLim: axes.y.range,
      xAxisLabel: null,
      yAxisLabel: null,
      showGrid: false,
      axisBox: true, // framed on all four sides, as the export's inset axes
      tool: "pointer",
      onReadout: () => {},
      seriesStyles: styles,
      fontSize: TICK_PX,
      linearPaths: LINEAR_PATHS,
      pointsPaths: POINTS_PATHS,
    });
    const range = (r: [number, number]) => (): uPlot.Range.MinMax => [r[0], r[1]];
    opts.scales = {
      ...opts.scales,
      x: { ...opts.scales?.x, auto: false, range: range(axes.x.range) },
      y: { ...opts.scales?.y, auto: false, range: range(axes.y.range) },
    };
    opts.axes = [fixAxis(opts.axes?.[0], axes.x), fixAxis(opts.axes?.[1], axes.y)];
    opts.cursor = { show: false, drag: { x: false, y: false, setScale: false } };
    opts.select = { show: false, left: 0, top: 0, width: 0, height: 0 };
    opts.legend = { show: false };
    const u = new uPlot(opts, payload.data, host);
    areaRef.current = (u.over as HTMLElement | undefined) ?? null;
    const under = u.under as HTMLElement | undefined;
    if (under?.style) under.style.background = resolvePlotBg(bg).axesBg; // the export's opaque axes face
    const ro = new ResizeObserver(() => u.setSize({ width: host.clientWidth || w, height: host.clientHeight || h }));
    ro.observe(host);
    return () => {
      ro.disconnect();
      areaRef.current = null;
      u.destroy();
    };
  }, [built, theme, accent, areaRef, bg]);

  if (built.notice !== null) {
    return (
      <div className="qzk-ds-meta" role="status" data-testid="layer-notice"
        style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", fontSize: 11, padding: 4, border: "1px solid var(--border)", background: resolvePlotBg(bg).axesBg }}>
        {built.notice || EMPTY_INSET_HINT}
      </div>
    );
  }
  return <div ref={hostRef} data-testid="layer-plot" style={{ position: "absolute", inset: 0 }} />;
}
