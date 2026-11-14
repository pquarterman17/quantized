// The UNFOCUSED plot window's legend (gap audit 2 #3). Before this, a
// background window drew no legend at all, so tiling two windows made the
// same graph look different depending on focus — and different from its own
// export. This is the read-only twin of `Stage/PlotLegend`: the same rows,
// swatches (`legendRowStyle`), title, waterfall order, colour scales and box
// placement (`legendBoxStyle` + the corner class / auto corner), fed from the
// window's OWN `PlotView` instead of the live singleton store. No handlers:
// the window is a live preview, and the first press on it focuses it
// (`PlotWindowFrame`), swapping in the interactive legend.

import { useMemo } from "react";

import { colorScaleLegendEntries, type ColorScatterSpec } from "../../lib/colorscatter";
import { legendNonCurves } from "../../lib/legendCurves";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import type { PlotView } from "../../lib/plotview";
import { SERIES_VARS, type SeriesCycle } from "../../lib/seriesStyleCycle";
import type { Dataset, DefaultTrace, SeriesStyle } from "../../lib/types";
import { withUnit } from "../../lib/uplotOpts";
import { waterfallLegendOrder } from "../../lib/waterfallOffset";
import { RichText } from "../primitives";
import ColorScaleChip from "../Stage/ColorScaleChip";
import LegendSample from "../Stage/LegendSample";
import { legendRowStyle } from "../Stage/legendRowStyle";
import { legendBoxStyle } from "../Stage/useLegendBox";

export interface BackgroundLegendProps {
  dataset: Dataset;
  view: PlotView;
  series: PlotSeriesSpec[];
  styleList?: (SeriesStyle | undefined)[];
  labels?: (string | undefined)[];
  seriesCycle?: SeriesCycle;
  plotted: number[];
  hidden?: boolean[];
  colorByColumns?: Map<number, ColorScatterSpec>;
  isDarkBg: boolean;
  inkColor?: string;
  defaultTrace?: DefaultTrace;
  staggeredRows: number;
}

export default function BackgroundLegend({
  dataset, view, series, styleList, labels, seriesCycle, plotted, hidden, colorByColumns,
  isDarkBg, inkColor, defaultTrace, staggeredRows,
}: BackgroundLegendProps) {
  const nonCurves = useMemo(() => legendNonCurves(dataset, view.errKeys), [dataset, view.errKeys]);
  const omitted = (i: number): boolean =>
    (hidden?.[i] ?? false) && (view.legendStatic || (i < plotted.length && nonCurves.has(plotted[i])));
  const legendTitle = view.legendTitle?.trim() || null;
  const colorScales =
    colorByColumns && colorByColumns.size > 0 ? colorScaleLegendEntries(dataset.data, colorByColumns) : [];
  const defaultLabel = (s: PlotSeriesSpec) => s.legend ?? withUnit(s.label, s.unit);
  const rowText = (s: PlotSeriesSpec, i: number) =>
    i < plotted.length ? (labels?.[i] ?? view.seriesLabels[plotted[i]] ?? defaultLabel(s)) : defaultLabel(s);
  const anyRow = series.some((s, i) => rowText(s, i) !== "" && !omitted(i));
  if (!anyRow && !legendTitle && colorScales.length === 0) return null;
  const visibleCount = plotted.filter((c) => !view.hiddenChannels.includes(c)).length;
  const pos = view.legendPos === "auto" && visibleCount > SERIES_VARS.length ? "out" : view.legendPos;
  const isFree = !!view.legendFrameXY || !!view.legendXY;
  return (
    <div
      className={`qzk-glass qzk-legend ${isFree ? "" : pos}`}
      style={legendBoxStyle(view.legendFrameXY, view.legendXY, view.legendSize)}
      role="group"
      aria-label="Plot legend"
    >
      <div className="qzk-legend-content">
        {legendTitle ? (
          <div className="it qzk-legend-title">
            <RichText text={legendTitle} />
          </div>
        ) : null}
        {waterfallLegendOrder(series.length, staggeredRows).map((i) => {
          const s = series[i];
          if (omitted(i)) return null;
          const text = rowText(s, i);
          if (text === "") return null;
          const { swatch, sample } = legendRowStyle(s, i, styleList, seriesCycle, isDarkBg, inkColor);
          const isHidden = hidden?.[i] ?? false;
          return (
            <div
              className="it"
              key={s.label}
              style={{ opacity: isHidden ? 0.4 : 1, textDecoration: isHidden ? "line-through" : "none" }}
            >
              <span className="qzk-legend-toggle">
                <LegendSample color={swatch} style={sample} defaultTrace={defaultTrace} filled={s.selected} />
                <RichText text={text} />
              </span>
            </div>
          );
        })}
        {colorScales.map((cs, i) => (
          <ColorScaleChip key={`cbar-${i}`} scale={cs} />
        ))}
      </div>
    </div>
  );
}
