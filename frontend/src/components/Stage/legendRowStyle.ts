// One legend row's swatch colour and sample style — shared by the focused
// window's interactive `PlotLegend` and the unfocused window's read-only
// `windows/BackgroundLegend` (gap audit 2 #3), so a graph's legend cannot
// look different depending on which window has focus.

import { resolveDrawColor } from "../../lib/contrastColor";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import { resolveSeriesStyle, type SeriesCycle } from "../../lib/seriesStyleCycle";
import type { SeriesStyle } from "../../lib/types";

/** The canvas' excluded companion: line-free 5px hollow circles. */
const EXCLUDED_SAMPLE: SeriesStyle = { width: 0, marker: true, markerShape: "circle", markerSize: 5 };
/** A fit band's legend sample: the dashed edge `uplotSeries` draws. */
const BAND_SAMPLE: SeriesStyle = { width: 1, line: "dashed" };
/** The canvas' selected-row companion: line-free 7px accent-filled circles. */
const SELECTED_SAMPLE: SeriesStyle = { width: 0, marker: true, markerShape: "circle", markerSize: 7 };

/** Row `i`'s swatch colour and sample style. Keep the CSS token for default
 *  series (re-themes); use the resolved override colour when one is set, so
 *  the legend matches the line. A literal (non-token) override runs through
 *  the SAME contrast check the canvas stroke uses (`buildOpts`'s
 *  `resolveDrawColor` call). A fit band's entry takes its curve's colour (as
 *  the canvas draws it). A greyed "(excluded)" companion is a dim marker; a
 *  "(selected)" companion is drawn in the accent, filled. */
export function legendRowStyle(
  s: PlotSeriesSpec,
  i: number,
  styleList: (SeriesStyle | undefined)[] | undefined,
  seriesCycle: SeriesCycle | undefined,
  isDarkBg: boolean,
  inkColor: string | undefined,
): { swatch: string; sample: SeriesStyle | undefined } {
  const ci = i - (s.band ?? 0);
  const override = styleList?.[ci]?.color;
  const swatch = s.selected
    ? "var(--accent)"
    : s.muted
      ? `var(${isDarkBg ? "--ink-dim-on-dark" : "--ink-dim-on-light"})`
      : override && !override.startsWith("--")
        ? resolveDrawColor(override, isDarkBg, inkColor)
        : override
          ? `var(${override})`
          : `var(--series-${(ci % 8) + 1})`;
  const sample = s.selected
    ? SELECTED_SAMPLE
    : s.muted
      ? EXCLUDED_SAMPLE
      : s.band
        ? BAND_SAMPLE
        : resolveSeriesStyle(styleList?.[i], i, seriesCycle ?? null);
  return { swatch, sample };
}
