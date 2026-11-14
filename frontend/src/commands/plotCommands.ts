// Plot-menu command registry entries (axis scale/format, waterfall,
// autoscale, grid/legend/stacked, panel fit, page setup, stat view,
// facet/break-x-axis) plus the Insert group (drawing shapes on plots — the
// menu-driven counterpart of PlotToolbar's dock flyout, MAIN #27) — split
// out of appCommands.ts (that module's own store-size ratchet, zero
// headroom). appCommands.ts stays the thin aggregator; this module owns
// every command whose `group` is "Plot" or "Insert". Behavior is
// unchanged — this is a verbatim move.

import type { StoreGet } from "../lib/exportActive";
import { plotInNewWindow } from "../lib/plotInNewWindow";
import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import { cycleAxisScale, cycleTickMode } from "../lib/plotview";
import type { Action } from "../store/commands";
import { openFigureDialog } from "../store/figureDialogs";
import { useRecipeManager } from "../store/recipeManager";
import { toast } from "../store/toasts";
import { onLoadFailure, runLazy } from "./fileCommands";

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
 *  runs this exact path — same busy indicator, same load-failure toast. */
export function sendFigureToReport(s: StoreGet): Promise<boolean> {
  return runLazy("Loading report tools…", () => import("../lib/sendFigureToReport")).then(
    async (m) => { await m.runSendFigureToReportCommand(s); return true; },
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
function graphFormatCommand(
  s: StoreGet,
  pick: (m: typeof import("../lib/graphTemplateCommands")) => (s: StoreGet) => void | Promise<void>,
): void {
  void runLazy("Loading graph templates…", () => import("../lib/graphTemplateCommands")).then(
    (m) => pick(m)(s),
    onLoadFailure,
  );
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
      label: "Cycle Y axis scale (linear/log/reciprocal)",
      description: "Switch the vertical axis between linear, logarithmic, and reciprocal scales.",
      run: () => s().setYScale(cycleAxisScale(s().yScale)),
    },
    {
      id: "yTickFormat", // MAIN #20: cycles auto -> fixed -> sci -> eng -> auto
      group: "Plot",
      section: "Axes",
      label: "Cycle Y tick format (auto/fixed/sci/eng)",
      description: "Change vertical-axis labels between automatic, fixed, scientific, and engineering notation.",
      run: () => s().setYFmt({ ...s().yFmt, mode: cycleTickMode(s().yFmt.mode) }),
    },
    {
      id: "waterfall",
      group: "Plot",
      section: "Layout",
      label: "Waterfall (stack datasets)…",
      description: "Separate overlapping curves with an adjustable vertical offset.",
      run: () => s().setWaterfallOpen(true),
    },
    {
      // P3.5: the unified browse surface. Plot-specific operations remain one
      // click away in the existing manager rather than being duplicated here.
      // Keep the established id: toolbar preferences persist command ids.
      id: "plot-recipe-manager",
      group: "Plot",
      section: "Layout",
      label: "Recipe Library…",
      description: "Browse every saved recipe and template.",
      keywords: "plot recipes manager",
      run: () => useRecipeManager.getState().openRecipeLibrary(),
    },
    // ── Plot ──
    {
      id: "autoscale",
      group: "Plot",
      section: "Axes",
      label: "Autoscale / reset view",
      description: "Reset zoom and restore automatic limits around the plotted data.",
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
      description: "Return to the preceding zoom or pan state.",
      shortcut: "Alt←",
      run: () => s().backView(),
    },
    {
      id: "view-forward",
      group: "Plot",
      section: "Axes",
      label: "Forward to next view",
      description: "Move forward to the next zoom or pan state.",
      shortcut: "Alt→",
      run: () => s().forwardView(),
    },
    {
      id: "xLog", // see the "yLog" command above — same cycle, X axis
      group: "Plot",
      section: "Axes",
      label: "Cycle X axis scale (linear/log/reciprocal)",
      description: "Switch the horizontal axis between linear, logarithmic, and reciprocal scales.",
      run: () => s().setXScale(cycleAxisScale(s().xScale)),
    },
    {
      id: "xTickFormat", // see the "yTickFormat" command above — same cycle, X axis
      group: "Plot",
      section: "Axes",
      label: "Cycle X tick format (auto/fixed/sci/eng)",
      description: "Change horizontal-axis labels between automatic, fixed, scientific, and engineering notation.",
      run: () => s().setXFmt({ ...s().xFmt, mode: cycleTickMode(s().xFmt.mode) }),
    },
    {
      id: "grid",
      group: "Plot",
      section: "Display",
      label: "Toggle grid lines",
      description: "Show or hide major plot grid lines.",
      run: () => s().setShowGrid(!s().showGrid),
    },
    {
      id: "legend",
      group: "Plot",
      section: "Display",
      label: "Toggle legend",
      description: "Show or hide the plot legend.",
      run: () => s().setShowLegend(!s().showLegend),
    },
    {
      id: "stacked",
      group: "Plot",
      section: "Layout",
      label: "Toggle stacked layout",
      description: "Switch between overlaid curves and vertically stacked plot lanes.",
      run: () => s().toggleStackLayout(), // S1 (a): a facet grid / saved break with stackMode off counts as ON
    },
    {
      id: "panel-fit",
      group: "Plot",
      section: "Layout",
      label: "Multi-panel fit (letterbox / fill)",
      description: "Choose whether a multi-panel page preserves its aspect ratio or fills the available stage.",
      keywords: "aspect window spatial page",
      run: () => s().cyclePanelFit(),
    },
    {
      id: "page-setup",
      group: "Plot",
      section: "Layout",
      label: "Page setup…",
      description: "Set publication-page dimensions and margins for layout and export.",
      keywords: "page size margins width height print export #54",
      run: () => openPageSetup(s),
    },
    {
      id: "statMode",
      group: "Plot",
      section: "Display",
      label: "Toggle statistics view (box / violin / Q-Q / histogram)",
      description: "Switch the active numeric column between its plot and statistical distribution views.",
      run: () => s().setStatMode(!s().statMode),
    },
    {
      // Figures audit #19: the toolbar's ⊕ sits in the View group, which is
      // the first to fold into "⋯" on a narrow window — so the magnifier
      // inset needs a menu/palette entry point of its own.
      id: "inset-mode",
      group: "Plot",
      section: "Display",
      label: "Magnifier inset",
      description: "Show a zoomed inset of a region over the plot.",
      keywords: "zoom inset magnify detail",
      checked: () => s().insetMode,
      run: () => s().setInsetMode(!s().insetMode),
    },
    {
      id: "facet-by-column",
      group: "Plot",
      section: "Layout",
      label: "Facet by column…",
      description: "Split data into small-multiple panels using the distinct values of a selected column.",
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
      description: "Detect large gaps in horizontal values and display a discontinuous x-axis.",
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
      description: "Hide a stretch of the vertical axis (Break from / Break to) so two separated ranges share one graph.",
      keywords: "axis break gap discontinuous",
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
      description: "Open the active dataset in a new plot window, independent of the currently focused window.",
      keywords: "duplicate window multiple views compare side by side library discoverability",
      run: () => {
        const id = s().activeId;
        if (!id) {
          toast("no active dataset", "danger");
          return;
        }
        plotInNewWindow(id);
      },
    },
    ...(
      [
        ["panel-row", "Panel: side by side", "row", "Arrange selected datasets in one horizontal row of aligned panels."],
        ["panel-column", "Panel: stacked", "column", "Arrange selected datasets in one vertical column of aligned panels."],
        ["panel-grid", "Panel: grid", "grid", "Arrange selected datasets in a compact grid of panels."],
        ["panel-overlay", "Overlay in one plot", "overlay", "Draw selected datasets together in one shared plot."],
      ] as const
    ).map(([id, label, layout, description]) => ({
      id,
      group: "Plot",
      section: "Layout",
      label,
      description,
      run: () => {
        const ids = s().selectedIds;
        if (ids.length < 2) {
          toast("select at least 2 datasets first", "danger");
          return;
        }
        s().focusWindow(s().createPanelWindow(ids, layout));
      },
    })),
    {
      // PLOT_WORKFLOW_PLAN #3: distinct from "Overlay in one plot" above —
      // that opens a composite panel window keeping each dataset separate;
      // this MERGES the selection into one real Library dataset (one curve
      // per dataset, segment-concatenated — see lib/originOverlay's
      // buildSelectionOverlay) so it plots, exports, and fits like any
      // ordinary single dataset.
      id: "plot-selected-together",
      group: "Plot",
      section: "Layout",
      label: "Plot selected together",
      description:
        "Merge two or more selected Library datasets into one overlay plot, one curve per dataset.",
      keywords: "combine merge overlay library selection",
      run: () => void plotSelectedTogether(s().selectedIds),
    },
    {
      // P3.6: the frontend producer of spec-carrying report figure blocks.
      // Click-only, like "Export figure…": the body (and the figure-spec
      // builder behind it) loads on demand via runLazy.
      id: "send-figure-to-report",
      group: "Plot",
      section: "Build & export",
      label: "Send figure to report…",
      description: "Add the current plot to a report; Word, PowerPoint and HTML report exports embed it as rendered.",
      keywords: "report figure embed word powerpoint docx pptx html",
      run: () => void sendFigureToReport(s),
    },
    // ── Figures audit #6 / #8: the Axis dialog and the plot-type gallery
    // (one lazy chunk, store/figureDialogs.ts). ──
    {
      id: "axis-dialog",
      group: "Plot",
      section: "Axes",
      label: "Axis…",
      description: "Edit an axis (scale, limits, break, ticks, number format, divide-by, fonts), or double-click the axis.",
      keywords: "scale limits ticks minor divide font break",
      run: () => openFigureDialog({ kind: "axis", axis: "x" }),
    },
    {
      id: "plot-type",
      group: "Plot",
      section: "Display",
      label: "Plot type…",
      description: "Switch the graph to line, scatter, area, column, box, violin, histogram, contour, double-Y, polar, waterfall, stacked panels or ternary.",
      keywords: "gallery bar histogram heatmap double y polar violin waterfall ternary panels",
      run: () => openFigureDialog({ kind: "plotType" }),
    },
    // ── Graph format (figures-audit B2; filed under "Display"): style-only templates and Origin-style
    // Copy/Paste Format. Style travels; data, limits and titles never do. ──
    {
      id: "graph-template-save",
      group: "Plot",
      section: "Display",
      label: "Save Graph Template…",
      description: "Save this graph's style (not its data) as a reusable template.",
      keywords: "style otp",
      run: () => graphFormatCommand(s, (m) => m.saveStageGraphTemplate),
    },
    {
      id: "graph-template-apply",
      group: "Plot",
      section: "Display",
      label: "Apply Graph Template…",
      description: "Restyle this graph with a saved template; its data is kept.",
      keywords: "style otp",
      run: () => graphFormatCommand(s, (m) => m.applyStageGraphTemplate),
    },
    {
      id: "copy-format",
      group: "Plot",
      section: "Display",
      label: "Copy Format",
      description: "Copy this graph's style (not its data).",
      keywords: "style",
      run: () => graphFormatCommand(s, (m) => m.copyStageFormat),
    },
    {
      id: "paste-format",
      group: "Plot",
      section: "Display",
      label: "Paste Format",
      description: "Apply the copied style to this graph; its data is kept.",
      keywords: "style",
      run: () => graphFormatCommand(s, (m) => m.pasteStageFormat),
    },
    // Gap-audit-2 #13: the same two, onto every graph of a folder or the
    // Library selection, as one undo step (lib/graphFormatBulk.ts).
    {
      id: "graph-template-apply-many",
      group: "Plot",
      section: "Display",
      label: "Apply Graph Template to Graphs…",
      description: "Restyle every graph in this folder, the Library selection, or all open graphs with a saved template; one undo step.",
      keywords: "style otp theme organizer folder all batch consistent",
      run: () => graphFormatCommand(s, (m) => m.applyGraphTemplateToGraphs),
    },
    {
      id: "paste-format-many",
      group: "Plot",
      section: "Display",
      label: "Paste Format to Graphs…",
      description: "Apply the copied style to every graph in this folder, the Library selection, or all open graphs; one undo step.",
      keywords: "style folder all batch consistent theme",
      run: () => graphFormatCommand(s, (m) => m.pasteFormatToGraphs),
    },
    // ── Insert (MAIN #27: drawing shapes on plots — the menu-driven
    // counterpart of PlotToolbar's dock flyout) ──
    {
      id: "insert-arrow",
      group: "Insert",
      label: "Arrow",
      description: "Draw an arrow annotation directly on the active plot.",
      run: () => s().setDrawShapeKind("arrow"),
    },
    {
      id: "insert-line",
      group: "Insert",
      label: "Line",
      description: "Draw a straight reference or annotation line on the active plot.",
      run: () => s().setDrawShapeKind("line"),
    },
    {
      id: "insert-rect",
      group: "Insert",
      label: "Rectangle",
      description: "Draw a rectangular region or callout on the active plot.",
      run: () => s().setDrawShapeKind("rect"),
    },
    {
      id: "insert-ellipse",
      group: "Insert",
      label: "Ellipse",
      description: "Draw an elliptical region or callout on the active plot.",
      run: () => s().setDrawShapeKind("ellipse"),
    },
    {
      id: "insert-textbox",
      group: "Insert",
      label: "Text box",
      description: "Place a movable rich-text annotation box on the active plot.",
      run: () => s().setDrawShapeKind("textbox"),
    },
  ];
}
