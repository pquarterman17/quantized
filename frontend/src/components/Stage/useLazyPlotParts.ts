// Load the on-demand uPlot plugin families (lib/axisExtrasHook.ts) the
// first time this plot needs them -- the Axis dialog's extras (figures-audit
// #6) once a format carries one, the quick-fit gadget frame while the
// "qfit" tool is active -- then ask the viewport to rebuild so `buildOpts`
// picks them up. A no-op for every plot needing neither.

import { useEffect } from "react";

import {
  axisExtrasApplier,
  gadgetPlugins,
  loadAxisExtras,
  loadGadgetPlugins,
  needsAxisExtras,
} from "../../lib/axisExtrasHook";
import type { AxisFormat } from "../../lib/types";

export function useLazyPlotParts(
  fmts: readonly (AxisFormat | null | undefined)[],
  tool: string,
  onReady: () => void,
): void {
  const needExtras = needsAxisExtras(...fmts) && axisExtrasApplier() === null;
  const needGadgets = tool === "qfit" && gadgetPlugins() === null;
  useEffect(() => {
    if (!needExtras && !needGadgets) return;
    let live = true;
    // A failed chunk load leaves that part undrawn (the plot itself is
    // complete without it); the next need retries.
    Promise.all([needExtras ? loadAxisExtras() : null, needGadgets ? loadGadgetPlugins() : null]).then(
      () => {
        if (live) onReady();
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onReady` is a fresh closure each render; only the needs decide.
  }, [needExtras, needGadgets]);
}
