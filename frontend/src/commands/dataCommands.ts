// Data-menu command registry entries (dataset math, pipeline, recalc,
// merge/duplicate/split, panel/overlay composites) — split out of
// appCommands.ts (that module's own store-size ratchet, zero headroom).
// appCommands.ts stays the thin aggregator; this module owns every command
// whose `group` is "Data". Behavior is unchanged — this is a verbatim move.

import type { StoreGet } from "../lib/exportActive";
import {
  runJoinWorksheets,
  runStackWorksheet,
  runTransposeWorksheet,
  runUnstackWorksheet,
} from "../lib/worksheetTransformCommands";
import type { Action } from "../store/commands";

/** Build the Data-group curated palette actions against the live store
 *  handle (`useApp.getState`) — store setters are stable, so callers build
 *  once. */
export function buildDataCommands(s: StoreGet): Action[] {
  return [
    {
      id: "dataset-math",
      group: "Data",
      section: "Combine & split",
      label: "Dataset math (combine two datasets)…",
      run: () => s().setDatasetMathOpen(true),
    },
    { id: "transpose", group: "Data", section: "Combine & split", label: "Transpose worksheet…", run: () => runTransposeWorksheet(s) },
    { id: "stack-columns", group: "Data", section: "Combine & split", label: "Stack columns to long form…", run: () => runStackWorksheet(s) },
    { id: "unstack-columns", group: "Data", section: "Combine & split", label: "Unstack / pivot to wide form…", run: () => runUnstackWorksheet(s) },
    { id: "join-by-key", group: "Data", section: "Combine & split", label: "Join datasets by key…", run: () => runJoinWorksheets(s) },
    {
      id: "tabulate",
      group: "Data",
      section: "Rows & summary",
      label: "Tabulate (group summary stats by column)…",
      run: () => s().setTabulateOpen(true),
    },
    {
      id: "pipeline",
      group: "Data",
      section: "Recalculation",
      label: "Pipeline (edit + re-run recorded steps)…",
      run: () => s().setPipelineOpen(true),
    },
    {
      id: "recalc-now",
      group: "Data",
      section: "Recalculation",
      label: "Recalculate now (run stale corrections + fits)",
      run: () => void s().recalcNow(),
    },
    {
      id: "recalc-mode",
      group: "Data",
      section: "Recalculation",
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
      section: "Rows & summary",
      label: "Data filter (live per-column row filter)…",
      run: () => s().setDataFilterOpen(true),
    },
    // ── Data ──
    {
      id: "merge",
      group: "Data",
      section: "Combine & split",
      label: "Merge selected datasets",
      run: () => s().mergeSelected(),
    },
    { id: "duplicate", group: "Data", section: "Combine & split", label: "Duplicate active dataset", run: () => { const id = s().activeId; if (id) s().duplicateDataset(id); } },
    { id: "reimport", group: "Data", section: "Recalculation", label: "Re-import active dataset", run: () => { const id = s().activeId; if (id) void s().reimportDataset(id); } },
    { id: "split", group: "Data", section: "Combine & split", label: "Split by column value…", run: () => { const id = s().activeId; if (id) s().openSplitDialog(id); } },
  ];
}
