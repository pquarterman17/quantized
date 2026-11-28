// Plot-menu command registry entries (axis scale/format, waterfall,
// autoscale, grid/legend/stacked, panel fit, page setup, stat view,
// facet/break-x-axis) plus the Insert group (drawing shapes on plots — the
// menu-driven counterpart of PlotToolbar's dock flyout, MAIN #27) — split
// out of appCommands.ts (that module's own store-size ratchet, zero
// headroom). appCommands.ts stays the thin aggregator; this module owns
// every command whose `group` is "Plot" or "Insert". Behavior is
// unchanged — this is a verbatim move.

import type { StoreGet } from "../lib/exportActive";
import { openLayerContents, openPlotSetup, plotSelectedTogether } from "../lib/plotSelectedTogether";
import { cycleAxisScale, cycleTickMode } from "../lib/plotview";
import { TURNED_TOOL_NOTE, turnedOf } from "../lib/uplotOrient";
import type { Action } from "../store/commands";
import { openFigureDialog } from "../store/figureDialogs";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";
import { onLoadFailure, runLazy } from "./fileCommands";
import { colorGradientCommand, legendFormatCommand, pasteFormatPartsCommand } from "./plotStyleCommands";

/** `lib/exchangeXY.ts` (what blocks Plot > Exchange X-Y axes, and the store guard
 *  that keeps it honest) is a lazy chunk the session starts loading with this
 *  module, as `lib/uplotOrient.ts` does for its overlay half. Until it lands the
 *  command reads "Loading…" and is off; a menu render after a failed load asks
 *  again. */
let xy: typeof import("../lib/exchangeXY") | undefined;
const xyNow = () => xy ?? void import("../lib/exchangeXY").then((m) => { xy = m; m.installExchangeGuard(useApp, toast); }, () => {});
xyNow();
const xyWhy = (s: StoreGet) => (xyNow() ? xy!.exchangeBlocker(s()) : "Loading…");

/** `lib/pageSetupCommand.ts` is the Page Setup dialog's seven-field
 *  `ParamDialog` builder and its confirm handler, reachable from nothing else
 *  in the entry graph — it only runs when the user picks "Page setup…". Its
 *  `run` body goes behind a dynamic `import()` (the metadata above it stays
 *  eager, so the menu, ⌘K and Help still list and search it unchanged), using
 *  the same `runLazy` wrapper the lazy export commands use: a pendingOps busy
 *  entry for the fetch, and a danger toast instead of an unhandled rejection
 *  if the chunk cannot load. Measured: 910,631 -> 910,172 B eager.
 *
 *  `onLoadFailure` is `.then`'s SECOND argument, not a trailing `.catch`: it
 *  must cover the LOAD only, so a rejection from `runPageSetupDialog` itself
 *  still surfaces instead of vanishing. */
function openPageSetup(s: StoreGet): void {
  void runLazy("Loading page setup…", () => import("../lib/pageSetupCommand")).then(
    (m) => m.runPageSetupDialog(s),
    onLoadFailure,
  );
}

/** "Send figure to report…" (P3.6). Same `runLazy` + `.then(act,
 *  onLoadFailure)` shape as `openPageSetup` above. Exported so the plot
 *  context menu's "Send to report…" (components/Stage/PlotContextMenu.tsx)
 *  runs this exact path — same busy indicator, same load-failure toast.
 *  Resolves true only when a figure was actually added to a report. */
export function sendFigureToReport(s: StoreGet, requirement?: import("../lib/sendFigureToReport").SendRequirement): Promise<boolean> {
  return runLazy("Loading report tools…", () => import("../lib/sendFigureToReport")).then(
    (m) => m.runSendFigureToReportCommand(s, requirement),
    () => { onLoadFailure(); return false; },
  );
}

/** The Library editable-figure sibling of {@link sendFigureToReport} above
 *  (finding #9, P3.6 review round 2): the SAME `runLazy` + `.then(act,
 *  onLoadFailure)` shape, one chunk load, one failure toast — previously
 *  duplicated verbatim in `components/Library/artifactContextActions.ts`'s
 *  "Add to Report…" handler. Kept here, beside its plot-menu sibling, so the
 *  label/lazy-path/failure-handling live in exactly one place. */
export function sendEditableFigureToReport(s: StoreGet, figureId: string): Promise<void> {
  return runLazy("Loading report tools…", () => import("../lib/sendFigureToReport")).then(
    (m) => m.runSendEditableFigureToReport(s, figureId),
    onLoadFailure,
  );
}

/** The Stage graph-template / Copy-Paste Format commands (figures-audit B2):
 *  the bodies load on demand, the same `runLazy` + `.then(act,
 *  onLoadFailure)` shape as `openPageSetup` above. */
const loadGraphFormat = () => import("../lib/graphTemplateCommands");
function graphFormatCommand(
  s: StoreGet,
  pick: (m: typeof import("../lib/graphTemplateCommands")) => (s: StoreGet) => void | Promise<void>,
): void {
  void runLazy("Loading graph templates…", loadGraphFormat).then(
    (m) => pick(m)(s),
    onLoadFailure,
  );
}

/** Gap audit 5 #1: the boot installs the default graph template from the same
 *  chunk, loaded only when one is set (a failed load leaves new graphs plain). */
export function warmDefaultGraphTemplate(): Promise<void> | undefined {
  try {
    // The key is lib/defaultGraphTemplate.ts's DEFAULT_GRAPH_TEMPLATE_KEY.
    if (localStorage.getItem("qz.defaultGraphTemplate")) return loadGraphFormat().then((m) => m.installDefaultGraphTemplate(), () => {});
  } catch {
    /* storage unavailable: no default (fail closed) */
  }
  return undefined;
}

/** Build the Plot- and Insert-group curated palette actions against the
 *  live store handle (`useApp.getState`) — store setters are stable, so
 *  callers build once. */
export function buildPlotCommands(s: StoreGet): Action[] {
  return [
    {
      id: "yLog", // MAIN #12: cycles linear -> log -> reciprocal -> linear
      group: "Plot",
      section: "Axes",
      label: "Cycle Y axis scale",
      run: () => s().setYScale(cycleAxisScale(s().yScale)),
    },
    {
      id: "yTickFormat", // MAIN #20: cycles auto -> fixed -> sci -> eng -> auto
      group: "Plot",
      section: "Axes",
      label: "Cycle Y tick format (auto/fixed/sci/eng)",
      run: () => s().setYFmt({ ...s().yFmt, mode: cycleTickMode(s().yFmt.mode) }),
    },
    {
      id: "waterfall",
      group: "Plot",
      section: "Layout",
      label: "Waterfall…",
      // Body lazy (bundle diet slice 34): the stacking runs after the click, so it loads then.
      run: () => void runLazy("Loading waterfall…", () => import("./waterfallCommand")).then((m) => m.applyWaterfall(), onLoadFailure),
    },
    {
      id: "waterfall-export",
      group: "Plot",
      section: "Layout",
      label: "Waterfall data export (CSV / 3-D)…",
      run: () => s().setWaterfallOpen(true),
    },
    { id: "contour-scattered", group: "Plot", section: "Layout", label: "Contour from scattered XYZ…", run: () => graphFormatCommand(s, (m) => m.contourFromScattered) },
    { id: "function-plot", group: "Plot", section: "Layout", label: "Function plot (y = f(x))…", run: () => s().setDatasetMathOpen(true, "function") },
    {
      // P3.5: the unified browse surface. Plot-specific operations remain one
      // click away in the existing manager rather than being duplicated here.
      // Keep the established id: toolbar preferences persist command ids.
      id: "plot-recipe-manager",
      group: "Plot",
      section: "Layout",
      label: "Recipe library…",
      run: () => void runLazy("Loading the recipe library…", () => import("../store/recipeManager")).then((m) => m.useRecipeManager.getState().openRecipeLibrary(), onLoadFailure),
    },
    // ── Plot ──
    {
      id: "autoscale",
      group: "Plot",
      section: "Axes",
      label: "Autoscale / reset view",
      shortcut: "A",
      run: () => s().recordView(
        { xLim: s().xLim, yLim: s().yLim },
        { xLim: null, yLim: null },
      ),
    },
    {
      id: "view-back",
      group: "Plot",
      section: "Axes",
      label: "Back to previous view",
      shortcut: "⌥←",
      run: () => s().backView(),
    },
    {
      id: "view-forward",
      group: "Plot",
      section: "Axes",
      label: "Forward to next view",
      shortcut: "⌥→",
      run: () => s().forwardView(),
    },
    {
      id: "xLog", // see the "yLog" command above — same cycle, X axis
      group: "Plot",
      section: "Axes",
      label: "Cycle X axis scale",
      run: () => s().setXScale(cycleAxisScale(s().xScale)),
    },
    {
      id: "xTickFormat", // see the "yTickFormat" command above — same cycle, X axis
      group: "Plot",
      section: "Axes",
      label: "Cycle X tick format (auto/fixed/sci/eng)",
      run: () => s().setXFmt({ ...s().xFmt, mode: cycleTickMode(s().xFmt.mode) }),
    },
    {
      id: "exchange-xy", // Exchange X-Y axes: lib/exchangeXY.ts says what cannot be turned
      group: "Plot",
      section: "Axes",
      label: "Exchange X–Y axes",
      checked: () => s().exchangeXY,
      disabled: () => !!xyWhy(s),
      disabledReason: () => xyWhy(s),
      run: () => { const why = xyWhy(s) || (s().activeId ? "" : "Import or select a dataset first"); if (why) toast(why); else xy!.toggleExchangeXY(useApp); }, // a palette pick of a blocked one says why; with no data it would only leave a ghost window (UX11 N3)
    },
    {
      id: "grid",
      group: "Plot",
      section: "Display",
      label: "Toggle grid lines",
      run: () => s().setShowGrid(!s().showGrid),
    },
    {
      id: "legend",
      group: "Plot",
      section: "Display",
      label: "Toggle legend",
      run: () => s().setShowLegend(!s().showLegend),
    },
    {
      id: "stacked",
      group: "Plot",
      section: "Layout",
      label: "Toggle stacked layout",
      run: () => s().toggleStackLayout(), // S1 (a): a facet grid / saved break with stackMode off counts as ON
    },
    {
      id: "panel-fit",
      group: "Plot",
      section: "Layout",
      label: "Multi-panel fit (letterbox / fill)",
      run: () => s().cyclePanelFit(),
    },
    {
      id: "page-setup",
      group: "Plot",
      section: "Layout",
      label: "Page setup…",
      run: () => openPageSetup(s),
    },
    {
      id: "statMode",
      group: "Plot",
      section: "Display",
      label: "Toggle statistics view",
      run: () => s().setStatMode(!s().statMode),
    },
    {
      // Figures audit #19: the toolbar's inset button sits in the View group, which is
      // the first to fold into "⋯" on a narrow window — so the magnifier
      // inset needs a menu/palette entry point of its own.
      id: "inset-mode",
      group: "Plot",
      section: "Display",
      label: "Magnifier inset",
      checked: () => s().insetMode,
      disabled: () => turnedOf(s()) && !s().insetMode, // the inset does not turn: not beside a turned plot
      disabledReason: TURNED_TOOL_NOTE,
      run: () => s().setInsetMode(!s().insetMode),
    },
    {
      id: "facet-by-column",
      group: "Plot",
      section: "Layout",
      label: "Facet by column…",
      // Body lazy (commands/plotLayoutCommands.ts): it only runs after a pick.
      run: () =>
        void runLazy("Loading facets…", () => import("./plotLayoutCommands")).then(
          (m) => m.runFacetByColumn(s),
          onLoadFailure,
        ),
    },
    {
      id: "break-x-axis",
      group: "Plot",
      section: "Layout",
      label: "Break x-axis at gaps…",
      // Body lazy (commands/plotLayoutCommands.ts): it only runs after a pick.
      run: () =>
        void runLazy("Loading x-axis breaks…", () => import("./plotLayoutCommands")).then(
          (m) => m.runBreakXAxis(s),
          onLoadFailure,
        ),
    },
    {
      // A Y break is an axis property (one frame, the stretch elided), so it
      // lives on the Axis dialog's Y tab; this is the menu's way there.
      id: "break-y-axis",
      group: "Plot",
      section: "Layout",
      label: "Break y-axis…",
      run: () => openFigureDialog({ kind: "axis", axis: "y" }),
    },
    {
      // Multi-plot discoverability: the palette counterpart of the Library
      // row's "Plot in new window" (lib/contextActions.ts's
      // `dataset.plotInNewWindow`) — a plain Library click only REBINDS the
      // focused window (unless pinned), so this was the missing "plot this
      // dataset again, styled differently, side by side" gesture.
      id: "plot-in-new-window",
      group: "Plot",
      section: "Layout",
      label: "Plot in new window",
      // Body lazy (commands/plotCommandsLazy.ts, bundle diet slice 34).
      run: () => void runLazy("Opening a new window…", () => import("./plotCommandsLazy")).then((m) => m.runPlotInNewWindow(s), onLoadFailure),
    },
    ...(
      [
        ["panel-row", "Panel: side by side", "row"],
        ["panel-column", "Panel: stacked", "column"],
        ["panel-grid", "Panel: grid", "grid"],
        ["panel-overlay", "Panel: overlay (separate scales)", "overlay"],
      ] as const
    ).map(([id, label, layout]) => ({
      id,
      group: "Plot",
      section: "Layout",
      label,
      run: () => {
        const ids = s().selectedIds;
        if (ids.length < 2) {
          toast("Select at least 2 datasets first.", "info");
          return;
        }
        s().focusWindow(s().createPanelWindow(ids, layout));
      },
    })),
    {
      // PLOT_WORKFLOW_PLAN #3: distinct from "Panel: overlay" above —
      // that opens a composite panel window keeping each dataset separate;
      // this lands ONE live graph (a Library dataset whose curves reference
      // their sources and follow their edits — lib/linkedCurves.ts) so it
      // plots, exports, and fits like any ordinary single dataset.
      id: "plot-selected-together",
      group: "Plot",
      section: "Layout",
      label: "Overlay in one plot", // UX8-C; "plot selected together" stays a keyword
      run: () => void plotSelectedTogether(s().selectedIds),
    },
    { id: "plot-setup", group: "Plot", section: "Layout", label: "Plot setup…", run: openPlotSetup },
    {
      // Origin gap audit 2 #1 / 3 N1: Origin's Layer Contents — one dialog
      // (no chained prompts) to add, remove, reorder and re-bind curves.
      id: "layer-contents",
      group: "Plot",
      section: "Layout",
      label: "Layer contents…",
      run: openLayerContents,
    },
    colorGradientCommand, // origin gap audit 4 G1 (commands/plotStyleCommands.ts)
    legendFormatCommand, // audit 6 M
    // Gap audit 3 N3 / 4 G19: the named way to set the windows' X or Y link
    // group ("link-x-axis", "link-y-axis").
    ...(["x", "y"] as const).map((a): Action => ({
      id: `link-${a}-axis`,
      group: "Plot",
      section: "Layout",
      label: `Link ${a.toUpperCase()} axis with…`,
      run: () => void runLazy("Loading window links…", () => import("../lib/windowLinkX")).then((m) => (a === "x" ? m.linkXAxisWith() : m.linkYAxisWith()), onLoadFailure),
    })),
    {
      id: "add-curve-from",
      group: "Plot",
      section: "Layout",
      label: "Add curve from…",
      run: openLayerContents,
    },
    {
      // P3.6: the frontend producer of spec-carrying report figure blocks.
      // Click-only, like "Export figure…": the body (and the figure-spec
      // builder behind it) loads on demand via runLazy.
      id: "send-figure-to-report",
      group: "Plot",
      section: "Export",
      label: "Send figure to report…",
      run: () => void sendFigureToReport(s),
    },
    // ── Figures audit #6 / #8: the Axis dialog and the plot-type gallery
    // (one lazy chunk, store/figureDialogs.ts). ──
    {
      id: "axis-dialog",
      group: "Plot",
      section: "Axes",
      label: "X axis settings…",
      run: () => openFigureDialog({ kind: "axis", axis: "x" }),
    },
    {
      id: "y-axis-settings", // gap audit 4 G11: Y3, Y4, ... (lib/multiYCommands.ts)
      group: "Plot",
      section: "Axes",
      label: "Y axis settings…",
      run: () => graphFormatCommand(s, (m) => m.editExtraYAxes), // rides the graph-format chunk (eager budget)
    },
    {
      id: "plot-type",
      group: "Plot",
      section: "Display",
      label: "Plot type…",
      run: () => openFigureDialog({ kind: "plotType" }),
    },
    // ── Graph format (figures-audit B2; filed under "Display"): style-only templates and Origin-style
    // Copy/Paste Format. Style travels; data, limits and titles never do. ──
    {
      id: "graph-template-save",
      group: "Plot",
      section: "Display",
      label: "Save graph template…",
      run: () => graphFormatCommand(s, (m) => m.saveStageGraphTemplate),
    },
    {
      id: "graph-template-apply",
      group: "Plot",
      section: "Display",
      label: "Apply graph template…",
      run: () => graphFormatCommand(s, (m) => m.applyStageGraphTemplate),
    },
    {
      id: "graph-template-default", // gap audit 5 #1: the look every new graph opens with
      group: "Plot",
      section: "Display",
      label: "Set as default for new graphs…",
      run: () => graphFormatCommand(s, (m) => m.setStageGraphAsDefault),
    },
    {
      id: "copy-format",
      group: "Plot",
      section: "Display",
      label: "Copy format",
      run: () => graphFormatCommand(s, (m) => m.copyStageFormat),
    },
    {
      id: "paste-format",
      group: "Plot",
      section: "Display",
      label: "Paste format",
      run: () => graphFormatCommand(s, (m) => m.pasteStageFormat),
    },
    pasteFormatPartsCommand(s), // plan item 42 (commands/plotStyleCommands.ts)
    // Gap-audit-2 #13: the same two, onto every graph of a folder or the
    // Library selection, as one undo step (lib/graphFormatBulk.ts).
    {
      id: "graph-template-apply-many",
      group: "Plot",
      section: "Display",
      label: "Apply graph template to graphs…",
      run: () => graphFormatCommand(s, (m) => m.applyGraphTemplateToGraphs),
    },
    {
      id: "paste-format-many",
      group: "Plot",
      section: "Display",
      label: "Paste format to graphs…",
      run: () => graphFormatCommand(s, (m) => m.pasteFormatToGraphs),
    },
    // ── Insert (MAIN #27: drawing shapes on plots — the menu-driven
    // counterpart of PlotToolbar's dock flyout) ──
    {
      id: "insert-arrow",
      group: "Insert",
      label: "Arrow",
      run: () => s().setDrawShapeKind("arrow"),
    },
    {
      id: "insert-line",
      group: "Insert",
      label: "Line",
      run: () => s().setDrawShapeKind("line"),
    },
    {
      id: "insert-rect",
      group: "Insert",
      label: "Rectangle",
      run: () => s().setDrawShapeKind("rect"),
    },
    {
      id: "insert-ellipse",
      group: "Insert",
      label: "Ellipse",
      run: () => s().setDrawShapeKind("ellipse"),
    },
    {
      id: "insert-textbox",
      group: "Insert",
      label: "Text box",
      run: () => s().setDrawShapeKind("textbox"),
    },
    // Gap audit 3 #15: Origin-style layers — bodies lazy (lib/graphLayerCommands.ts).
    layer("inset", "Inset graph…"),
    layer("image", "Image…"),
    layer("table", "Table…"),
  ];
}

/** An Insert ▸ layer command (`insert-inset` / `-image` / `-table`): the body loads on first use. */
const layer = (kind: "inset" | "image" | "table", label: string): Action => ({
  id: `insert-${kind}`, group: "Insert", label,
  run: () => void runLazy("Loading layers…", () => import("../lib/graphLayerCommands")).then((m) => m.insertGraphLayer(kind), onLoadFailure),
});
