// Data-menu command registry entries (dataset math, pipeline, recalc,
// merge/duplicate/split, panel/overlay composites) — split out of
// appCommands.ts (that module's own store-size ratchet, zero headroom).
// appCommands.ts stays the thin aggregator; this module owns every command
// whose `group` is "Data". Behavior is unchanged — this is a verbatim move.

import type { StoreGet } from "../lib/exportActive";
import type { Action } from "../store/commands";
import type { RecalcMode } from "../lib/recalc";
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

/** Origin's names for the three modes (worksheet audit #22): "off" is
 *  Origin's "None" — and the status says what "Recalculate now" does there. */
const RECALC_MODE_STATUS: Record<RecalcMode, string> = {
  auto: "Auto (stale results rerun automatically)",
  manual: "Manual (results are marked stale; Recalculate now reruns them)",
  off: "None (nothing is tracked; Recalculate now reruns every derived result)",
};

/** Row statistics / Frequency count — one lazy chunk for both (audit #19). */
function statsRun(s: StoreGet, which: "row" | "freq"): void {
  void import("../store/worksheetStatsRun").then(
    (m) => (which === "row" ? m.runRowStatistics() : m.runFrequencyCount()),
    () => s().setStatus(`couldn't load ${which === "row" ? "Row statistics" : "Frequency count"} — try again`, "danger"),
  );
}

const loadFailed = (s: StoreGet) => () => s().setStatus("couldn't load the worksheet tools — try again", "danger");

/** Data > Sort worksheet…: the header menu's dialog, on the active dataset. */
async function sortWorksheetCommand(s: StoreGet): Promise<void> {
  const ds = s().datasets.find((d) => d.id === s().activeId);
  if (!ds) return;
  try {
    const [dialogs, text] = await Promise.all([
      import("../components/Stage/worksheet/worksheetDialogs"),
      import("../components/Stage/worksheet/textColumns"),
    ]);
    await dialogs.sortWorksheetDialog(ds, String(ds.data.metadata?.["x_column_name"] ?? "X"), text.worksheetTextColumns(ds.data, ds.pending));
  } catch {
    loadFailed(s)();
  }
}

/** Data > Add column: append a blank column after the last data column (the header menu's "Add new column"). */
async function addColumnCommand(s: StoreGet): Promise<void> {
  const ds = s().datasets.find((d) => d.id === s().activeId);
  if (!ds) return;
  try {
    const m = await import("../store/worksheetColumns");
    m.insertColumn(ds.id, ds.data.labels.length); // clamped to the last base column
  } catch {
    loadFailed(s)();
  }
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
      run: () => window.dispatchEvent(new Event(SHOW_SQLITE_QUERY)),
    },
    {
      // MAIN #38: find a column or note inside a dataset you do not have open —
      // the thing a Library filter cannot do.
      id: "find-in-project",
      group: "Data",
      section: "Import & query",
      label: "Find in project…",
      run: () => s().setSearchOpen(true),
    },
    {
      // MAIN #32: the trash shipped with restore/purge already tested, but no
      // way to SEE it — a safety net nobody can find is not one.
      id: "trash",
      group: "Data",
      section: "Import & query",
      label: "Trash (restore deleted datasets)…",
      run: () => s().setTrashOpen(true),
    },
    {
      id: "dataset-math",
      group: "Data",
      section: "Combine & split",
      label: "Dataset math…",
      run: () => s().setDatasetMathOpen(true),
    },
    {
      // P2.5 align/interpolate: the Library selection, else the active
      // dataset, seeds the pick; the workshop previews before creating.
      id: "resample",
      group: "Data",
      section: "Combine & split",
      label: "Resample / align to a common grid…",
      run: () => openResampleDialog(seedIds(s)),
    },
    { id: "meta-factors", group: "Data", section: "Combine & split", label: "Metadata → factors…", run: () => openMetaFactors(seedIds(s)) },
    { id: "transpose", group: "Data", section: "Combine & split", label: "Transpose worksheet…", run: () => openReshape(s, "transpose") },
    { id: "stack-columns", group: "Data", section: "Combine & split", label: "Stack columns to long form…", run: () => openReshape(s, "stack") },
    { id: "unstack-columns", group: "Data", section: "Combine & split", label: "Unstack / pivot to wide form…", run: () => openReshape(s, "unstack") },
    { id: "remove-duplicate-rows", group: "Data", section: "Rows & summary", label: "Remove duplicate rows…", run: () => openReshape(s, "dedupe") },
    { id: "fill-missing-values", group: "Data", section: "Rows & summary", label: "Fill or drop missing values…", run: () => openReshape(s, "fillmissing") },
    { id: "standardize-columns", group: "Data", section: "Rows & summary", label: "Z-score / min-max / rank columns…", run: () => openReshape(s, "standardize") },
    { id: "join-by-key", group: "Data", section: "Combine & split", label: "Join datasets by key…", run: () => openReshape(s, "join") },
    {
      id: "tabulate",
      group: "Data",
      section: "Rows & summary",
      label: "Tabulate…",
      run: () => s().setTabulateOpen(true),
    },
    // Worksheet audit #19 — lazy bodies (store/worksheetStatsRun.ts).
    {
      id: "row-statistics",
      group: "Data",
      section: "Rows & summary",
      label: "Row statistics…",
      run: () => statsRun(s, "row"),
    },
    {
      id: "frequency-count",
      group: "Data",
      section: "Rows & summary",
      label: "Frequency count…",
      run: () => statsRun(s, "freq"),
    },
    {
      id: "pipeline",
      group: "Data",
      section: "Recalculation",
      label: "Pipeline…",
      run: () => s().setPipelineOpen(true),
    },
    {
      id: "recalc-now",
      group: "Data",
      section: "Recalculation",
      label: "Recalculate now",
      run: () => {
        // Worksheet audit #22: "off" tracks nothing, so the request must
        // recalculate everything derived rather than an (always empty) stale set.
        // (store/recalcDatasets.markEverythingStale says so in the status.)
        void s().recalcNow({ everything: s().recalcMode === "off" });
      },
    },
    {
      id: "recalc-mode",
      group: "Data",
      section: "Recalculation",
      label: "Recalc mode (auto, manual, none)",
      run: () => {
        const order = ["auto", "manual", "off"] as const;
        const cur = s().recalcMode;
        const next = order[(order.indexOf(cur) + 1) % order.length];
        s().setRecalcMode(next);
        s().setStatus(`recalc mode: ${RECALC_MODE_STATUS[next]}`);
      },
    },
    // UX menus audit N7: these two lived only in the column header menu (and Sort worksheet was not
    // even in the palette). Same dialogs and store calls as the header menu; lazy bodies.
    {
      id: "sort-worksheet",
      group: "Data",
      section: "Rows & summary",
      label: "Sort worksheet…",
      run: () => void sortWorksheetCommand(s),
    },
    {
      id: "add-column",
      group: "Data",
      section: "Rows & summary", // listed under Columns (appMenuPlacement.ts)
      label: "Add column",
      run: () => void addColumnCommand(s),
    },
    {
      id: "data-filter",
      group: "Data",
      section: "Rows & summary",
      label: "Data filter…",
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
    { id: "duplicate", group: "Data", section: "Combine & split", label: "Duplicate active dataset", run: () => { const id = s().activeId; if (id) return s().duplicateDataset(id); } },
    { id: "reimport", group: "Data", section: "Recalculation", label: "Re-import active dataset", run: () => { const id = s().activeId; if (id) void s().reimportDataset(id); } },
    { id: "split", group: "Data", section: "Combine & split", label: "Split by column value…", run: () => { const id = s().activeId; if (id) s().openSplitDialog(id); } },
  ];
}
