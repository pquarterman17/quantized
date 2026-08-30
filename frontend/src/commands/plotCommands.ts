// Plot-menu command registry entries (axis scale/format, waterfall,
// autoscale, grid/legend/stacked, panel fit, page setup, stat view,
// facet/break-x-axis) plus the Insert group (drawing shapes on plots — the
// menu-driven counterpart of PlotToolbar's dock flyout, MAIN #27) — split
// out of appCommands.ts (that module's own store-size ratchet, zero
// headroom). appCommands.ts stays the thin aggregator; this module owns
// every command whose `group` is "Plot" or "Insert". Behavior is
// unchanged — this is a verbatim move.

import { askParams } from "../components/overlays/ParamDialog";
import type { StoreGet } from "../lib/exportActive";
import { runPageSetupDialog } from "../lib/pageSetupCommand";
import { plotInNewWindow } from "../lib/plotInNewWindow";
import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import { cycleAxisScale, cycleTickMode } from "../lib/plotview";
import type { Action } from "../store/commands";
import { useRecipeManager } from "../store/recipeManager";
import { toast } from "../store/toasts";

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
      run: () => s().setStackMode(!s().stackMode),
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
      run: () => void runPageSetupDialog(s),
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
      id: "facet-by-column",
      group: "Plot",
      section: "Layout",
      label: "Facet by column…",
      description: "Split data into small-multiple panels using the distinct values of a selected column.",
      run: async () => {
        const ds = s().datasets.find((d) => d.id === s().activeId);
        if (!ds) {
          toast("no active dataset", "danger");
          return;
        }
        if (ds.data.labels.length === 0) {
          toast("active dataset has no columns to facet by", "danger");
          return;
        }
        // Disambiguate duplicate labels (real instrument imports can repeat
        // a column name) so the reverse `indexOf` lookup below always maps
        // the picked option back to the SAME channel the user saw.
        const raw = ds.data.labels.map((lab, i) => lab || `Column ${i + 1}`);
        const counts = new Map<string, number>();
        for (const lab of raw) counts.set(lab, (counts.get(lab) ?? 0) + 1);
        const options = raw.map((lab, i) => (counts.get(lab)! > 1 ? `${lab} (col ${i + 1})` : lab));
        const params = await askParams("Facet by column", [
          {
            key: "column",
            label: "Column",
            type: "select",
            default: options[0],
            options,
            hint: "One small-multiples panel per distinct level, sharing the x-axis",
          },
        ]);
        if (!params) return;
        const col = options.indexOf(String(params.column));
        if (col < 0) return;
        s().facetByColumn(ds.id, col);
      },
    },
    {
      id: "break-x-axis",
      group: "Plot",
      section: "Layout",
      label: "Break x-axis at gaps…",
      description: "Detect large gaps in horizontal values and display a discontinuous x-axis.",
      run: async () => {
        const ds = s().datasets.find((d) => d.id === s().activeId);
        if (!ds) {
          toast("no active dataset", "danger");
          return;
        }
        const params = await askParams("Break x-axis at gaps", [
          {
            key: "gapFactor",
            label: "Gap factor",
            type: "number",
            default: 4,
            hint: "A gap at least this many times the median x-spacing becomes a break",
          },
        ]);
        if (!params) return;
        s().breakAtGaps(ds.id, undefined, Number(params.gapFactor));
      },
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
