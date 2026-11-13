// PlotViewport's props, moved verbatim out of PlotViewport.tsx (the 400-line
// component ceiling) when the figures-audit #6 axis-extras loader landed.

import type { RefObject } from "react";
import type uPlot from "uplot";

import type { HalfLim } from "../../lib/axisLim";
import type { PlotPayload } from "../../lib/plotdata";
import type { BuildOptsArgs } from "../../lib/uplotOpts";
import type { Accent, AnchorEditBridge, PeakWizardEditBridge, Theme } from "../../store/useApp";

export interface PlotViewportProps
  extends Omit<BuildOptsArgs, "width" | "height" | "peakWizardEdit" | "anchorEdit" | "xLim" | "yLim"> {
  displayPayload: PlotPayload | null;
  /** Committed X/Y limits; a null side is auto for that side (`useResolvedLims`). */
  xLim?: HalfLim | null;
  yLim?: HalfLim | null;
  onLimCrossed?: (axis: "x" | "y", why?: "log") => void; // a half-open limit fell back to full auto, or "log": a side <= 0 was dropped
  /** The live uPlot instance, exposed as a controlled ref so the caller can
   *  drive toolbar/context-menu actions over it (see `usePlotStageActions`). */
  plotRef: RefObject<uPlot | null>;
  /** Force a rebuild on theme/accent change: `buildOpts` reads `--accent` /
   *  `--series-*` CSS custom properties at BUILD time (via `seriesColor()`),
   *  so a token change needs a fresh instance even though neither value is a
   *  literal `buildOpts` argument. */
  theme: Theme;
  accent: Accent;
  /** Peak Analyzer wizard click-on-plot marker editing (RAW bridge, not yet
   *  wrapped into `buildOpts`'s `{markers,onAdd,onRemove}` shape). Kept as its
   *  own prop rather than folded into the spread below so the effect's
   *  dependency array can key off this STABLE store-selected reference,
   *  instead of a fresh wrapper object that would otherwise be reconstructed
   *  (and compare unequal) on every render. */
  peakWizardEdit: PeakWizardEditBridge | null;
  /** Anchor-point baseline editing (GOTO #2) — RAW store bridge, same
   *  stable-reference reasoning as `peakWizardEdit` above, but STRONGER
   *  (MAIN #8f): the bridge is identity-stable across anchor edits (anchors
   *  flow through its `getAnchors` getter), so this dependency only rebuilds
   *  the plot on anchor-mode activation/deactivation — never per gesture. */
  anchorEdit: AnchorEditBridge | null;
  /** Cross-window link group (MULTI_PLOT_PLAN item 13): when set, this
   *  instance joins the uPlot cursor-sync group `syncKey` AND the module
   *  x-range sync registry (`lib/windowsync`) — the MultiPanelStage sync
   *  idiom, patched onto `buildOpts`'s result rather than widening
   *  `buildOpts` itself, so its other callers (MultiPanelStage,
   *  WaterfallView, ReflPanel, InsetPlot) are untouched. Undefined (the
   *  default, and every pre-item-13 caller) applies no patch at all. */
  syncKey?: string;
  /** Top inset (px) of the plot host, default 8. The MAIN stage passes a
   *  larger value to reserve the floating tool-dock's band — the dock is an
   *  overlay at top-center, and without the reservation a centered plot
   *  title rendered exactly behind it (owner report 2026-07-11: "titles get
   *  lost, covered by the top menu"). Window consumers (panel cells,
   *  snapshot/background windows) have title bars instead of docks and keep
   *  the default; a taller dock pushes it down (`--qz-dock-clear`, audit #15). */
  insetTop?: number;
  /** Publish the plot-frame rect as CSS vars on the enclosing `.qzk-stage`
   *  (decode #52), so a frame-anchored `PlotLegend` sibling can place itself
   *  via calc(). Only the main interactive stage (PlotStage) mounts that
   *  legend, so background / snapshot / panel windows leave this off (default)
   *  and keep their plugin-free data pipeline. */
  frameVars?: boolean;
}
