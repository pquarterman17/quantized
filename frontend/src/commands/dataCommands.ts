// Data-menu command registry entries (dataset math, pipeline, recalc,
// merge/duplicate/split, panel/overlay composites) — split out of
// appCommands.ts (that module's own store-size ratchet, zero headroom).
// appCommands.ts stays the thin aggregator; this module owns every command
// whose `group` is "Data". Behavior is unchanged — this is a verbatim move.

import type { StoreGet } from "../lib/exportActive";
import type { Action } from "../store/commands";
import { openMetaFactors } from "../store/metaFactorsDialog";
import { openResampleDialog } from "../store/resampleDialog";
import { SHOW_SQLITE_QUERY } from "../store/sqliteQueryDialog";
import { openTransformPreview, seedIds, type PreviewOp } from "../store/transformPreviewDialog";

/** P2.5: the reshapes and the join open the lazy Reshape & combine workshop
 *  (a live preview before anything is created) with the ACTIVE dataset as the
 *  primary input, any other selected dataset after it. */
function openReshape(s: StoreGet, op: PreviewOp): void {
  const active = s().activeId;
  const ids = seedIds(s);
  openTransformPreview(op, active ? [active, ...ids.filter((id) => id !== active)] : ids);
}

/** Build the Data-group curated palette actions against the live store
 *  handle (`useApp.getState`) — store setters are stable, so callers build
 *  once. */
export function buildDataCommands(s: StoreGet): Action[] {
  return [
    {
      id: "sqlite-query",
      group: "Data",
      section: "Import & query",
      label: "Query SQLite database…",
      description: "Run a read-only query against a SQLite database and import the result as a dataset.",
      run: () => window.dispatchEvent(new Event(SHOW_SQLITE_QUERY)),
    },
    {
      // MAIN #38: find a column or note inside a dataset you do not have open —
      // the thing a Library filter cannot do.
      id: "find-in-project",
      group: "Data",
      section: "Import & query",
      label: "Find in project…",
      description: "Search dataset names, columns, notes, and metadata across the entire project.",
      run: () => s().setSearchOpen(true),
    },
    {
      // MAIN #32: the trash shipped with restore/purge already tested, but no
      // way to SEE it — a safety net nobody can find is not one.
      id: "trash",
      group: "Data",
      section: "Import & query",
      label: "Trash (restore deleted datasets)…",
      description: "Review, restore, or permanently purge datasets moved to project trash.",
      run: () => s().setTrashOpen(true),
    },
    {
      id: "dataset-math",
      group: "Data",
      section: "Combine & split",
      label: "Dataset math (combine two datasets)…",
      description: "Create a derived dataset by mathematically combining two existing datasets.",
      run: () => s().setDatasetMathOpen(true),
    },
    {
      // P2.5 align/interpolate: the Library selection, else the active
      // dataset, seeds the pick; the workshop previews before creating.
      id: "resample",
      group: "Data",
      section: "Combine & split",
      label: "Resample / align to a common grid…",
      description: "Interpolate one or more datasets onto a new x-grid or another dataset's x, with a live preview.",
      keywords: "interpolate interp1 align regrid common grid match x resample",
      run: () => openResampleDialog(seedIds(s)),
    },
    { id: "meta-factors", group: "Data", section: "Combine & split", label: "Metadata → factors…", description: "Clean up metadata; add a metadata field as a factor column.", keywords: "promote sample unify", run: () => openMetaFactors(seedIds(s)) },
    { id: "transpose", group: "Data", section: "Combine & split", label: "Transpose worksheet…", description: "Swap worksheet rows and columns in a new derived dataset.", keywords: "reshape", run: () => openReshape(s, "transpose") },
    { id: "stack-columns", group: "Data", section: "Combine & split", label: "Stack columns to long form…", description: "Reshape selected wide columns into value and category columns in long form.", keywords: "jmp reshape stack long form wide", run: () => openReshape(s, "stack") },
    { id: "unstack-columns", group: "Data", section: "Combine & split", label: "Unstack / pivot to wide form…", description: "Pivot category and value columns into separate columns in a wide worksheet.", keywords: "jmp unstack pivot wide long reshape", run: () => openReshape(s, "unstack") },
    { id: "join-by-key", group: "Data", section: "Combine & split", label: "Join datasets by key…", description: "Combine two datasets by matching values in selected key columns.", keywords: "jmp join merge key combine text reshape", run: () => openReshape(s, "join") },
    {
      id: "tabulate",
      group: "Data",
      section: "Rows & summary",
      label: "Tabulate (group summary stats by column)…",
      description: "Calculate grouped summary statistics and create a linked result table.",
      keywords: "jmp tabulate group summary statistics aggregate",
      run: () => s().setTabulateOpen(true),
    },
    {
      id: "pipeline",
      group: "Data",
      section: "Recalculation",
      label: "Pipeline (edit + re-run recorded steps)…",
      description: "Inspect, edit, and rerun the reproducible transformation and analysis steps.",
      keywords: "jmp jsl script recipe save replay reproducible",
      run: () => s().setPipelineOpen(true),
    },
    {
      id: "recalc-now",
      group: "Data",
      section: "Recalculation",
      label: "Recalculate now (run stale corrections + fits)",
      description: "Immediately rerun corrections and fits whose inputs or settings have changed.",
      run: () => void s().recalcNow(),
    },
    {
      id: "recalc-mode",
      group: "Data",
      section: "Recalculation",
      label: "Recalc mode (cycle auto → manual → off)",
      description: "Choose whether stale calculations rerun automatically, on request, or not at all.",
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
      description: "Filter worksheet rows interactively using conditions on one or more columns.",
      keywords: "jmp local data filter rows condition level range",
      run: () => s().setDataFilterOpen(true),
    },
    // ── Data ──
    {
      id: "merge",
      group: "Data",
      section: "Combine & split",
      label: "Merge selected datasets",
      description: "Append the selected datasets' rows into one new dataset, by column position or name, with a live preview.",
      keywords: "append concatenate reshape",
      run: () => s().mergeSelected(),
    },
    { id: "duplicate", group: "Data", section: "Combine & split", label: "Duplicate active dataset", description: "Create an independent copy of the active dataset in the current folder.", run: () => { const id = s().activeId; if (id) return s().duplicateDataset(id); } },
    { id: "reimport", group: "Data", section: "Recalculation", label: "Re-import active dataset", description: "Reload the active dataset from its recorded source using the saved import settings.", run: () => { const id = s().activeId; if (id) void s().reimportDataset(id); } },
    { id: "split", group: "Data", section: "Combine & split", label: "Split by column value…", description: "Create one derived dataset for each distinct value in a selected column.", keywords: "jmp by group split factor level separate", run: () => { const id = s().activeId; if (id) s().openSplitDialog(id); } },
  ];
}
