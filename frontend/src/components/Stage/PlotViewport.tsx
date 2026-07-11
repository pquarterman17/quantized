// The plot render core: the uPlot create/resize/destroy lifecycle, driven
// entirely by props (payload + view/style config + size via its own
// ResizeObserver) — NO store reads. Split out of PlotStage.tsx
// (MULTI_PLOT_PLAN item 1 / PROJECT_ORGANIZATION_PLAN #10) so the same core
// can later mount per-window (item 4), fed by a background window's `PlotView`
// snapshot instead of the live singleton store fields, with no change to this
// file. `plotRef` is a CONTROLLED prop (not an internal ref) so the caller
// (PlotStage today; a future PlotWindowFrame) can drive toolbar/context-menu
// actions (reset view, save PNG, copy data, …) over the same uPlot instance —
// see `usePlotStageActions`.

import { type RefObject, useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import type { PlotPayload } from "../../lib/plotdata";
import { buildOpts, type BuildOptsArgs } from "../../lib/uplotOpts";
import { registerSyncPlot, windowXSyncHook } from "../../lib/windowsync";
import type { Accent, AnchorEditBridge, PeakWizardEditBridge, Theme } from "../../store/useApp";

export interface PlotViewportProps
  extends Omit<BuildOptsArgs, "width" | "height" | "peakWizardEdit" | "anchorEdit"> {
  displayPayload: PlotPayload | null;
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
}

/** The uPlot host + its create/resize/destroy effect. Renders a single
 *  absolutely-positioned div (matches today's Stage layout byte-for-byte);
 *  every other Stage chrome (toolbar, legend, readouts, context menu) is a
 *  sibling owned by the caller. */
export default function PlotViewport(props: PlotViewportProps) {
  const { displayPayload, plotRef, theme, accent, peakWizardEdit, anchorEdit, syncKey, ...args } =
    props;
  const hostRef = useRef<HTMLDivElement>(null);

  // (Re)create the uPlot instance when payload / size / theme change.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !displayPayload) {
      plotRef.current?.destroy();
      plotRef.current = null;
      return;
    }
    const w = host.clientWidth || 600;
    // uPlot's title div sits above the plot and its height is NOT counted in the
    // height we pass, so reserve room for it (matches the .u-title CSS height) to
    // keep the x-axis inside the overflow-hidden host.
    const titleH = args.title?.trim() ? 24 : 0;
    const h = (host.clientHeight || 400) - titleH;
    plotRef.current?.destroy();
    const opts = buildOpts(displayPayload, {
      ...args,
      width: w,
      height: h,
      peakWizardEdit: peakWizardEdit && {
        markers: peakWizardEdit.markers,
        onAdd: peakWizardEdit.addPeakAt,
        onRemove: peakWizardEdit.removePeak,
      },
      anchorEdit: anchorEdit && {
        getAnchors: anchorEdit.getAnchors,
        onAdd: anchorEdit.addAnchor,
        onMove: anchorEdit.moveAnchor,
        onRemove: anchorEdit.removeAnchor,
      },
    });
    if (syncKey) {
      // Item 13 (cross-window link groups) — the MultiPanelStage sync idiom,
      // applied POST-buildOpts so no other buildOpts caller changes: cursor
      // sync via uPlot's own registry keyed by `syncKey`; x-zoom/pan sync via
      // the `lib/windowsync` group registry (its hook APPENDS to any hooks
      // buildOpts set — never clobbers `setSelect`).
      opts.cursor = { ...opts.cursor, sync: { key: syncKey } };
      opts.hooks = {
        ...opts.hooks,
        setScale: [...(opts.hooks?.setScale ?? []), windowXSyncHook(syncKey)],
      };
    }
    const plot = new uPlot(opts, displayPayload.data, host);
    plotRef.current = plot;
    const unregister = syncKey ? registerSyncPlot(syncKey, plot) : null;

    const ro = new ResizeObserver(() => {
      plotRef.current?.setSize({
        width: host.clientWidth || w,
        height: (host.clientHeight || 400) - titleH,
      });
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      unregister?.();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // theme/accent recolor from fresh tokens (see the prop doc above); tool
    // rebuilds the cursor/drag config + plugins; gadgetMode swaps the qfit
    // tool's plugin (ROI band vs paired cursors) — a discrete pick, not a
    // live-drag value. qfitRoi/gadgetCursors are read imperatively by the
    // caller (NOT reactive deps here) so a live drag never tears this
    // instance down; peakWizardEdit IS a normal reactive dep — a discrete
    // add/remove click, not a live drag. args.bg (item 18) rebuilds so a
    // window's background-override toggle re-resolves axis/grid/ink colours
    // and the literal-colour contrast substitution immediately.
  }, [
    displayPayload,
    theme,
    accent,
    peakWizardEdit,
    anchorEdit,
    args.yLog,
    args.xLog,
    args.xLim,
    args.yLim,
    args.xStep,
    args.yStep,
    args.y2Lim,
    args.y2Log,
    args.y2Step,
    args.xFmt,
    args.yFmt,
    args.showGrid,
    args.axisBox,
    args.fontSize,
    args.baseLineWidth,
    args.defaultTrace,
    args.wheelZoom,
    args.title,
    args.xAxisLabel,
    args.yAxisLabel,
    args.y2AxisLabel,
    args.refLines,
    args.annotations,
    args.regionShades,
    args.seriesStyles,
    args.plotted,
    args.seriesLabels,
    args.errorBars,
    args.colorByColumns,
    args.hidden,
    args.tool,
    args.integral,
    args.fwhmResult,
    args.gadgetMode,
    args.bg,
    syncKey,
  ]);

  return <div ref={hostRef} style={{ position: "absolute", inset: 8 }} />;
}
