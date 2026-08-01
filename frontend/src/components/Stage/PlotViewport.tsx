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

import { type RefObject, useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import type { PlotPayload } from "../../lib/plotdata";
import {
  buildDecimatedData,
  decimatePlugin,
  decimationEligible,
  shouldDecimate,
  xExtent,
} from "../../lib/plotDecimate";
import { classifyLimChange, type Lim } from "../../lib/plotLimApply";
import { frameVarsPlugin } from "../../lib/uplotFrameVars";
import { buildOpts, xIsAscending, type BuildOptsArgs } from "../../lib/uplotOpts";
import { registerSyncPlot, windowXSyncHook } from "../../lib/windowsync";
// loadPlotPerfPrefs is a plain localStorage read (like uplotOpts.ts's cssVar()
// DOM read) — not a Zustand store subscription, so it doesn't break this
// file's "driven entirely by props, NO store reads" contract (same reasoning
// PreferencesDialog.tsx documents for the store-independent prefs it reads).
import { loadPlotPerfPrefs } from "../../store/prefs";
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
  /** Top inset (px) of the plot host, default 8. The MAIN stage passes a
   *  larger value to reserve the floating tool-dock's band — the dock is an
   *  overlay at top-center, and without the reservation a centered plot
   *  title rendered exactly behind it (owner report 2026-07-11: "titles get
   *  lost, covered by the top menu"). Window consumers (panel cells,
   *  snapshot/background windows) have title bars instead of docks and keep
   *  the default. */
  insetTop?: number;
  /** Publish the plot-frame rect as CSS vars on the enclosing `.qzk-stage`
   *  (decode #52), so a frame-anchored `PlotLegend` sibling can place itself
   *  via calc(). Only the main interactive stage (PlotStage) mounts that
   *  legend, so background / snapshot / panel windows leave this off (default)
   *  and keep their plugin-free data pipeline. */
  frameVars?: boolean;
}

/** The uPlot host + its create/resize/destroy effect. Renders a single
 *  absolutely-positioned div (matches today's Stage layout byte-for-byte);
 *  every other Stage chrome (toolbar, legend, readouts, context menu) is a
 *  sibling owned by the caller. */
export default function PlotViewport(props: PlotViewportProps) {
  const { displayPayload, plotRef, theme, accent, peakWizardEdit, anchorEdit, syncKey, insetTop, frameVars, ...args } =
    props;
  const hostRef = useRef<HTMLDivElement>(null);

  // P0.4 follow-up #8 (docs/performance_envelope.md): a committed zoom/pan
  // used to tear down and rebuild the WHOLE uPlot instance, because
  // xLim/yLim/y2Lim were create-effect deps — even though the gesture that
  // committed them (wheelZoomPlugin/panPlugin, via viewHistoryPlugin) had
  // already painted the exact same scale live via `u.setScale`. `limsRef`
  // holds the latest committed lims for the create effect to read (the
  // "latest ref" pattern — satisfies react-hooks/exhaustive-deps without a
  // disable comment, since a `.current` read isn't a tracked dependency);
  // the effect below it updates the ref on every commit and, only when the
  // live instance can't just be nudged via `u.setScale` (see
  // `classifyLimChange`'s doc), bumps `rebuildEpoch` — the ONLY thing that
  // still forces the create effect to run for a lim-only change.
  const limsRef = useRef<{ x: Lim; y: Lim; y2: Lim }>({
    x: args.xLim ?? null,
    y: args.yLim ?? null,
    y2: args.y2Lim ?? null,
  });
  const [rebuildEpoch, setRebuildEpoch] = useState(0);

  // Declared BEFORE the create/destroy effect so that within a single commit
  // where a lim change lands ALONGSIDE a genuine structural change (e.g. a
  // workspace restore that sets xLim and theme together), `limsRef` is
  // already fresh by the time the create effect (below) reads it — React
  // runs same-commit effects in declaration order.
  useEffect(() => {
    const prev = limsRef.current;
    const next: { x: Lim; y: Lim; y2: Lim } = {
      x: args.xLim ?? null,
      y: args.yLim ?? null,
      y2: args.y2Lim ?? null,
    };
    limsRef.current = next;
    const plot = plotRef.current;
    if (!plot) return; // no live instance yet — the create effect will pick up `next` via limsRef when it (re)builds.

    let needsRebuild = false;
    (["x", "y", "y2"] as const).forEach((axis) => {
      if (axis === "y2" && !plot.scales.y2) return; // no live y2 scale to nudge (payload carries no y2 series)
      const live = plot.scales[axis];
      const kind = classifyLimChange(prev[axis], next[axis], live?.min, live?.max);
      if (kind === "apply") {
        const lim = next[axis];
        if (lim) plot.setScale(axis, { min: lim[0], max: lim[1] });
      } else if (kind === "rebuild") {
        needsRebuild = true;
      }
    });
    if (needsRebuild) setRebuildEpoch((e) => e + 1);
    // plotRef is a stable RefObject identity for this component's lifetime
    // (owned by the caller, e.g. PlotStage's own useRef) — listed so
    // exhaustive-deps doesn't warn; it never actually changes across renders.
  }, [args.xLim, args.yLim, args.y2Lim, plotRef]);

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
    // Read the LATEST committed lims through the ref (see its declaration
    // above), never `args.xLim`/`yLim`/`y2Lim` directly: this is what lets
    // xLim/yLim/y2Lim stay OFF this effect's own deps below while every
    // structural rebuild (payload/theme/tool/… change) still bakes in the
    // current view instead of whatever lim happened to be true the last time
    // THIS effect ran.
    const curLims = limsRef.current;
    const opts = buildOpts(displayPayload, {
      ...args,
      xLim: curLims.x,
      yLim: curLims.y,
      y2Lim: curLims.y2,
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
    // Frame-rect bridge (decode #52): publish the plotting-area rect as CSS
    // vars on `.qzk-stage` so a frame-anchored PlotLegend can place itself via
    // calc(). Patched post-buildOpts (like `syncKey`) and only for the main
    // stage (`frameVars`) — background/snapshot/panel windows mount no legend,
    // so they keep their plugin-free data pipeline.
    if (frameVars) opts.plugins = [...(opts.plugins ?? []), frameVarsPlugin()];
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
    // View-window min/max decimation (P0.4): patched post-buildOpts, same
    // idiom as frameVars/syncKey above, so it applies to every PlotViewport
    // caller (main stage, background/panel/snapshot windows) with no per-
    // caller wiring. `lib/plotDecimate.ts` is the single chokepoint — see its
    // header for the full mechanism and `decimationEligible`'s doc for every
    // guard (overlays/companions, non-ascending x, error bars, scatter mode).
    // P3.4: `displayPayload.decimated` means the SERVER already bucketed this
    // payload to (approximately) the draw contract before it crossed the wire
    // (usePlotPayload.ts's fetch effect requested it) — re-bucketing an
    // already-bucketed row set client-side would only discard picked extrema
    // for no size/latency gain, so that path is skipped entirely here. Client
    // decimation stays live for the offline fallback (`buildColumns` never
    // sets `decimated`) and for any payload the server declined to decimate
    // (non-ascending x, error bars, etc. — `fromResponse` sets `decimated:
    // false` in every such case, so this gate still lets the client's OWN
    // (differently-scoped) eligibility checks run normally).
    const fullX = displayPayload.data[0] as (number | null)[];
    const decimate =
      !displayPayload.decimated &&
      loadPlotPerfPrefs().decimateDensePlots &&
      shouldDecimate(fullX.length, w) &&
      decimationEligible({
        seriesColumnCount: displayPayload.series.length,
        plottedCount: args.plotted?.length,
        xAscending: xIsAscending(fullX),
        hasErrorBars: !!(args.errorBars && args.errorBars.size > 0),
        hasErrorSpans: !!(args.errorSpans && args.errorSpans.size > 0),
        defaultTrace: args.defaultTrace,
        hasColorByColumns: !!(args.colorByColumns && args.colorByColumns.size > 0),
      });
    let plotData = displayPayload.data;
    if (decimate) {
      // uPlot.AlignedData's y-column element type is `number | null | undefined`
      // (TypedArray-friendly); this codebase's own columns only ever use `null`
      // for a missing value (never `undefined` — see plotdata.ts), so the same
      // `as (number | null)[][]` narrowing plotdata.ts already uses throughout
      // (e.g. maskExcludedPayload) applies here too.
      const fullData = displayPayload.data as (number | null)[][];
      const [x0, x1] = curLims.x ?? xExtent(fullX) ?? [0, 1];
      plotData = buildDecimatedData(fullData, x0, x1, w) as uPlot.AlignedData;
      opts.plugins = [...(opts.plugins ?? []), decimatePlugin(() => fullData)];
    }
    const plot = new uPlot(opts, plotData, host);
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
    //
    // xLim/yLim/y2Lim are DELIBERATELY not deps here (P0.4 follow-up #8):
    // the lim-tracking effect above classifies every commit and either
    // nudges the live instance via `u.setScale` (the common case — see
    // `classifyLimChange`'s doc) or bumps `rebuildEpoch`, which IS a dep,
    // for the rarer autoscale-restore/shape-change case. xStep/yStep/y2Step
    // stay as-is: a commit that nulls a previously-set tick step still
    // rebuilds once (acceptable and rare — steps only change alongside a
    // lim edit, which no longer forces this effect on its own).
  }, [
    displayPayload,
    theme,
    accent,
    peakWizardEdit,
    anchorEdit,
    rebuildEpoch,
    args.yScale,
    args.xScale,
    args.xStep,
    args.yStep,
    args.y2Scale,
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
    args.annotationEdit,
    args.axisLabelEdit,
    args.shapes,
    args.shapeEdit,
    args.shapeDraw,
    args.regionShades,
    args.seriesStyles,
    args.plotted,
    args.seriesLabels,
    args.errorBars,
    args.errorSpans,
    args.colorByColumns,
    args.hidden,
    args.tool,
    args.integral,
    args.fwhmResult,
    args.gadgetMode,
    args.bg,
    syncKey,
  ]);

  return <div ref={hostRef} style={{ position: "absolute", inset: 8, top: insetTop ?? 8 }} />;
}
