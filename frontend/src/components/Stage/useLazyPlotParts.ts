// Load the on-demand uPlot plugin families (lib/axisExtrasHook.ts) the
// first time this plot needs them -- the Axis dialog's extras (figures-audit
// #6) once a format carries one, the quick-fit gadget frame while the
// "qfit" tool is active -- then ask the viewport to rebuild so `buildOpts`
// picks them up. The same for the two chunks every session loads at startup
// (figures leftover g): a plot whose labels carry an Origin escape, or that
// has reference lines / region shades, drawn before the escape rewrite
// (`lib/richtext.originEscapesSettled`) or the shade / off-scale drawing
// (`lib/uplotOverlays.regionDecorSettled`) landed, rebuilds once it settles,
// so a first plot never keeps literal escapes or misses its shades. A no-op
// for every plot needing none of these.

import { useEffect } from "react";

import {
  axisExtrasApplier,
  gadgetPlugins,
  loadAxisExtras,
  loadGadgetPlugins,
  needsAxisExtras,
} from "../../lib/axisExtrasHook";
import { awaitsOriginEscapes, originEscapesSettled } from "../../lib/richtext";
import type { AxisFormat } from "../../lib/types";
import { regionDecorReady, regionDecorSettled } from "../../lib/uplotOverlays";

/** What the startup chunks would change on this plot: every label it draws
 *  (title, axis titles, series and annotation text) and whether it has any
 *  reference line or region shade (the shade / off-scale drawing). */
export interface LazyDecorNeeds {
  texts: readonly (string | null | undefined)[];
  overlays: boolean;
}

/** The `LazyDecorNeeds` of a viewport's labels, payload and overlays. */
export function plotDecorNeeds(
  labels: readonly (string | null | undefined)[],
  payload: { xLabel?: string; series: readonly { label: string }[] } | null | undefined,
  annotations: readonly { text?: string }[] | null | undefined,
  overlays: number,
): LazyDecorNeeds {
  return {
    texts: [...labels, payload?.xLabel, ...(payload?.series.map((s) => s.label) ?? []), ...(annotations ?? []).map((a) => a.text)],
    overlays: overlays > 0,
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
  const needEscapes = decor.texts.some(awaitsOriginEscapes);
  const needDecor = decor.overlays && !regionDecorReady();
  useEffect(() => {
    if (!needExtras && !needGadgets && !needEscapes && !needDecor) return;
    let live = true;
    // A failed chunk load leaves that part undrawn (the plot itself is
    // complete without it); the next need retries. The startup chunks never
    // reject (a failure settles them with nothing to draw).
    Promise.all([
      needExtras ? loadAxisExtras() : null,
      needGadgets ? loadGadgetPlugins() : null,
      needEscapes ? originEscapesSettled : null,
      needDecor ? regionDecorSettled : null,
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
  }, [needExtras, needGadgets, needEscapes, needDecor]);
}
