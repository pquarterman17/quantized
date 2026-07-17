// Data-menu command registry entries (dataset math, pipeline, recalc,
// merge/duplicate/split, panel/overlay composites) — split out of
// appCommands.ts (that module's own store-size ratchet, zero headroom).
// appCommands.ts stays the thin aggregator; this module owns every command
// whose `group` is "Data". Behavior is unchanged — this is a verbatim move.

import type { StoreGet } from "../lib/exportActive";
import type { Action } from "../store/commands";
import { toast } from "../store/toasts";

/** Build the Data-group curated palette actions against the live store
 *  handle (`useApp.getState`) — store setters are stable, so callers build
 *  once. */
export function buildDataCommands(s: StoreGet): Action[] {
  return [
    {
      id: "dataset-math",
      group: "Data",
      label: "Dataset math (combine two datasets)…",
      run: () => s().setDatasetMathOpen(true),
    },
    {
      id: "tabulate",
      group: "Data",
      label: "Tabulate (group summary stats by column)…",
      run: () => s().setTabulateOpen(true),
    },
    {
      id: "pipeline",
      group: "Data",
      label: "Pipeline (edit + re-run recorded steps)…",
      run: () => s().setPipelineOpen(true),
    },
    {
      id: "recalc-now",
      group: "Data",
      label: "Recalculate now (run stale corrections + fits)",
      run: () => void s().recalcNow(),
    },
    {
      id: "recalc-mode",
      group: "Data",
      label: "Recalc mode (cycle auto → manual → off)",
      run: () => {
        const order = ["auto", "manual", "off"] as const;
        const cur = s().recalcMode;
        const next = order[(order.indexOf(cur) + 1) % order.length];
        s().setRecalcMode(next);
        s().setStatus(`recalc mode: ${next}`);
      },
    },
    {
      id: "data-filter",
      group: "Data",
      label: "Data filter (live per-column row filter)…",
      run: () => s().setDataFilterOpen(true),
    },
    // ── Data ──
    {
      id: "merge",
      group: "Data",
      label: "Merge selected datasets",
      run: () => s().mergeSelected(),
    },
    { id: "duplicate", group: "Data", label: "Duplicate active dataset", run: () => { const id = s().activeId; if (id) s().duplicateDataset(id); } },
    { id: "reimport", group: "Data", label: "Re-import active dataset", run: () => { const id = s().activeId; if (id) void s().reimportDataset(id); } },
    { id: "split", group: "Data", label: "Split by column value…", run: () => { const id = s().activeId; if (id) s().openSplitDialog(id); } },
    // Panel/overlay composite windows over the current selection (MAIN_PLAN
    // #19 v1) — the command-palette counterparts of the Library's quick
    // picks (lib/panelMenu.ts), acting on the live multi-selection.
    ...(
      [
        ["panel-row", "Panel: side by side", "row"],
        ["panel-column", "Panel: stacked", "column"],
        ["panel-grid", "Panel: grid", "grid"],
        ["panel-overlay", "Overlay in one plot", "overlay"],
      ] as const
    ).map(([id, label, layout]) => ({
      id,
      group: "Data",
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
  ];
}
