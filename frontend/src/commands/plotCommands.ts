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
import { cycleAxisScale, cycleTickMode } from "../lib/plotview";
import type { Action } from "../store/commands";
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
      label: "Waterfall (stack datasets)…",
      run: () => s().setWaterfallOpen(true),
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
    { id: "view-back", group: "Plot", section: "Axes", label: "Back to previous view", shortcut: "Alt←", run: () => s().backView() },
    { id: "view-forward", group: "Plot", section: "Axes", label: "Forward to next view", shortcut: "Alt→", run: () => s().forwardView() },
    {
      id: "xLog", // see the "yLog" command above — same cycle, X axis
      group: "Plot",
      section: "Axes",
      label: "Cycle X axis scale (linear/log/reciprocal)",
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
      run: () => s().setStackMode(!s().stackMode),
    },
    { id: "panel-fit", group: "Plot", section: "Layout", label: "Multi-panel fit (letterbox / fill)", keywords: "aspect window spatial page", run: () => s().cyclePanelFit() },
    { id: "page-setup", group: "Plot", section: "Layout", label: "Page setup…", keywords: "page size margins width height print export #54", run: () => void runPageSetupDialog(s) },
    {
      id: "statMode",
      group: "Plot",
      section: "Display",
      label: "Toggle statistics view (box / violin / Q-Q / histogram)",
      run: () => s().setStatMode(!s().statMode),
    },
    {
      id: "facet-by-column",
      group: "Plot",
      section: "Layout",
      label: "Facet by column…",
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
    ...(
      [
        ["panel-row", "Panel: side by side", "row"],
        ["panel-column", "Panel: stacked", "column"],
        ["panel-grid", "Panel: grid", "grid"],
        ["panel-overlay", "Overlay in one plot", "overlay"],
      ] as const
    ).map(([id, label, layout]) => ({
      id,
      group: "Plot",
      section: "Layout",
      label,
      run: () => {
        const ids = s().selectedIds;
        if (ids.length < 2) {
          toast("select at least 2 datasets first", "danger");
          return;
        }
        s().focusWindow(s().createPanelWindow(ids, layout));
      },
    })),
    // ── Insert (MAIN #27: drawing shapes on plots — the menu-driven
    // counterpart of PlotToolbar's dock flyout) ──
    { id: "insert-arrow", group: "Insert", label: "Arrow", run: () => s().setDrawShapeKind("arrow") },
    { id: "insert-line", group: "Insert", label: "Line", run: () => s().setDrawShapeKind("line") },
    { id: "insert-rect", group: "Insert", label: "Rectangle", run: () => s().setDrawShapeKind("rect") },
    { id: "insert-ellipse", group: "Insert", label: "Ellipse", run: () => s().setDrawShapeKind("ellipse") },
    { id: "insert-textbox", group: "Insert", label: "Text box", run: () => s().setDrawShapeKind("textbox") },
  ];
}
