// Load the on-demand uPlot plugin families (lib/axisExtrasHook.ts) the
// first time this plot needs them -- the Axis dialog's extras (figures-audit
// #6) once a format carries one, the quick-fit gadget frame while the
// "qfit" tool is active -- then ask the viewport to rebuild so `buildOpts`
// picks them up. The same for the two chunks every session loads at startup
// (figures leftover g): a plot whose labels carry an Origin escape, or that
// has reference lines / region shades, drawn before the escape rewrite
// (`lib/richtext.originEscapesSettled`) or the shade / off-scale drawing
// (`lib/uplotOverlays.regionDecorSettled`) landed, rebuilds once it settles,
// so a first plot never keeps literal escapes or misses its shades -- and the
// canvas title drawing (`lib/richLabelsLoader.ts`) likewise. The tool-dock
// plugins (pan, cursor readout, measure, region statistics, integrate, FWHM;
// bundle diet slice 27) load the same way while one of those tools is picked
// or an integral / FWHM result is drawn, and a horizontal bar graph built
// before the overlay half of its turn (`lib/uplotOrient.orientTurnSettled`,
// a startup chunk) landed rebuilds once it settles. A no-op for every plot
// needing none of these.

import { useEffect, useState } from "react";

import {
  axisExtrasApplier,
  gadgetPlugins,
  loadAxisExtras,
  loadGadgetPlugins,
  loadToolPlugins,
  needsAxisExtras,
  needsToolPlugins,
  toolPlugins,
} from "../../lib/axisExtrasHook";
import { awaitsOriginEscapes, originEscapesSettled } from "../../lib/originEscapeLoader";
import type { AxisFormat, SeriesStyle } from "../../lib/types";
import { hasHorizontalBars, orientTurnReady, orientTurnSettled } from "../../lib/uplotOrient";
import { regionDecorReady, regionDecorSettled } from "../../lib/regionDecorLoader";
import { richLabelsReady, richLabelsSettled } from "../../lib/richLabelsLoader";

/** What the startup chunks would change on this plot: every label it draws
 *  (title, axis titles, series and annotation text) and whether it has any
 *  reference line or region shade (the shade / off-scale drawing). */
export interface LazyDecorNeeds {
  texts: readonly (string | null | undefined)[];
  overlays: boolean;
  /** An integral or FWHM result is drawn (its tool's plugin draws it). */
  regionResult?: boolean;
  /** Horizontal bars: the plot is turned (lib/uplotOrient.ts). */
  turned?: boolean;
}

/** The `LazyDecorNeeds` of a viewport's labels, payload and overlays. */
export function plotDecorNeeds(
  labels: readonly (string | null | undefined)[],
  payload: { xLabel?: string; series: readonly { label: string }[] } | null | undefined,
  annotations: readonly { text?: string }[] | null | undefined,
  overlays: number,
  styles?: readonly (SeriesStyle | undefined)[],
): LazyDecorNeeds {
  return {
    texts: [...labels, payload?.xLabel, ...(payload?.series.map((s) => s.label) ?? []), ...(annotations ?? []).map((a) => a.text)],
    overlays: overlays > 0,
    ...(hasHorizontalBars(styles) ? { turned: true } : {}),
  };
}

export function useLazyPlotParts(
  fmts: readonly (AxisFormat | null | undefined)[],
  tool: string,
  onReady: () => void,
  decor: LazyDecorNeeds = { texts: [], overlays: false },
): void {
  const needExtras = needsAxisExtras(...fmts) && axisExtrasApplier() === null;
  const needGadgets = tool === "qfit" && gadgetPlugins() === null;
  const needTools = needsToolPlugins(tool, decor.regionResult) && toolPlugins() === null;
  const needEscapes = decor.texts.some(awaitsOriginEscapes);
  const needDecor = decor.overlays && !regionDecorReady();
  const needTurn = !!decor.turned && !orientTurnReady();
  // The canvas title drawing (lib/richLabelsLoader.ts): any plot with a label
  // rebuilds once it lands, so rich / moved / draggable titles appear.
  const needTitles = !richLabelsReady() && decor.texts.some((t) => !!t?.trim());
  useEffect(() => {
    if (!needExtras && !needGadgets && !needTools && !needEscapes && !needDecor && !needTitles && !needTurn) return;
    let live = true;
    // A failed chunk load leaves that part undrawn (the plot itself is
    // complete without it); the next need retries. The startup chunks never
    // reject (a failure settles them with nothing to draw).
    Promise.all([
      needExtras ? loadAxisExtras() : null,
      needGadgets ? loadGadgetPlugins() : null,
      needTools ? loadToolPlugins() : null,
      needEscapes ? originEscapesSettled : null,
      needDecor ? regionDecorSettled : null,
      needTitles ? richLabelsSettled : null,
      needTurn ? orientTurnSettled : null,
    ]).then(
      () => {
        if (live) onReady();
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onReady` is a fresh closure each render; only the needs decide.
  }, [needExtras, needGadgets, needTools, needEscapes, needDecor, needTitles, needTurn]);
}

/** `useLazyPlotParts` for a renderer that rebuilds on a counter (the
 *  multi-panel stage): the counter, bumped each time a needed part lands. */
export function useLazyPlotEpoch(
  fmts: readonly (AxisFormat | null | undefined)[],
  tool: string,
  decor?: LazyDecorNeeds,
): number {
  const [epoch, setEpoch] = useState(0);
  useLazyPlotParts(fmts, tool, () => setEpoch((e) => e + 1), decor);
  return epoch;
}
