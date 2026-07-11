// Per-series fill-under / fill-between-series styling (MAIN #13). Builds
// uPlot's OWN native fill mechanisms from a `SeriesStyle.fill` value — never a
// custom draw hook, so a fill composes correctly with zoom/pan/theme rebuilds
// like any other series option:
//  - "under"     -> `series.fill` + `series.fillTo` (uPlot's built-in
//                   line-to-baseline fill; `fillTo` defaults to 0, matching
//                   the "fill to a ZERO baseline" contract this feature promises).
//  - {vs: <ch>}  -> a top-level `opts.bands` entry (`uPlot.Band`), which fills
//                   the area between two ALREADY-DRAWN series. Only a `vs`
//                   channel that is currently plotted can be resolved — uPlot
//                   bands, like the export's `fill_between(y, other)`
//                   counterpart, need both curves' data already on the plot.
//
// Fill colour is always DERIVED from the series' own resolved stroke colour
// (never a separately stored colour), at a fixed translucency — via
// `color-mix()`, the same runtime-translucency idiom `styles/components.css`
// already uses for badges (`color-mix(in oklab, var(--danger) 18%, transparent)`),
// so it respects whatever token/override produced that stroke (palette token,
// re-themed literal, Origin-imported colour, …) with zero new colour state.

import type uPlot from "uplot";

import type { SeriesStyle } from "./types";

/** Fixed fill translucency (percent opacity of the source colour) — semi-
 *  transparent so data drawn under/behind a fill stays legible, matching the
 *  weight of the existing `REGION_SHADE_ALPHA` (0.25) shade convention in
 *  `uplotOverlays.ts`. Kept in sync with the export side's `_FILL_ALPHA`
 *  (`calc/figure.py`) so a screen fill and its exported figure read the same. */
export const FILL_ALPHA_PCT = 25;

/** A translucent variant of any resolved CSS colour (hex / oklch / rgb —
 *  whatever `seriesColor`/`resolveDrawColor` produced) at `pct`% opacity. */
export function translucent(color: string, pct = FILL_ALPHA_PCT): string {
  return `color-mix(in oklab, ${color} ${pct}%, transparent)`;
}

/** One series' `fill`/`fillTo` uPlot props for the "under" case (fixed at a
 *  ZERO baseline, never the scale's own min/max). `{vs}` bands are NOT
 *  resolved here — see `resolveFillBands` (a band is a top-level `opts.bands`
 *  entry spanning TWO series, not a per-series prop). Empty object = no fill,
 *  the default. */
export function seriesFillProps(
  fill: SeriesStyle["fill"],
  stroke: string,
): { fill?: string; fillTo?: uPlot.Series.FillTo } {
  if (fill === "under") return { fill: translucent(stroke), fillTo: 0 };
  return {};
}

/** Build uPlot `opts.bands` for every plotted series whose style requests a
 *  fill BETWEEN it and another channel (`fill: {vs: channel}`). `plotted[i]`
 *  is the dataset-channel index of display series `i` (`usePlotPayload`'s
 *  array — the SAME space `fill.vs` is expressed in); a `vs` channel absent
 *  from `plotted` (not currently drawn) is silently skipped, matching the
 *  export resolver's same-shaped fallback (`calc/plotting.resolve_style_channels`).
 *  `strokeOf(i)` resolves display series `i`'s ALREADY-COMPUTED stroke colour
 *  (the band fill is that colour, translucent) — a callback rather than a
 *  precomputed array so the caller (`buildOpts`) can reuse the exact `stroke`
 *  const it derives per series in its own series-building loop. */
export function resolveFillBands(
  plotted: readonly number[],
  styles: readonly (SeriesStyle | undefined)[],
  strokeOf: (displayIndex: number) => string,
): uPlot.Band[] {
  const bands: uPlot.Band[] = [];
  plotted.forEach((_ch, i) => {
    const fill = styles[i]?.fill;
    if (!fill || fill === "none" || fill === "under") return;
    const vsIndex = plotted.indexOf(fill.vs);
    if (vsIndex === -1 || vsIndex === i) return;
    // uPlot series indices are 1-based (0 = the x series).
    bands.push({ series: [i + 1, vsIndex + 1], fill: translucent(strokeOf(i)) });
  });
  return bands;
}
