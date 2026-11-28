// LIBRARY_WORKBOOK_UX_PLAN PR K, slice 2 (L0.50): derived worksheets +
// Freeze Copy — extracted into its own slice (the store/computedColumns.ts
// pattern) so useApp.ts only gains the extends-union + creator-spread lines.
//
// A DERIVED WORKSHEET is an ordinary Dataset with `derivedFrom` set (K2):
// `.corrections` IS its re-runnable pipeline recipe (the SAME CorrectionParams
// shape `applyCorrections` already uses — no new pipeline DSL invented), and
// `.raw` is a cache of its SOURCE's raw/data as of the last recompute (never
// hand-edited). `createDerivedWorksheet` runs the pipeline once against the
// CURRENT source and commits the result as a brand-new dataset in the same
// workbook — the source itself is never mutated (L0.13 non-destructive
// precedent). `recomputeDerivedSheet` (called ONLY from useApp.ts's
// `recalcNow` — the async stale-marked scheduler, K5c) re-runs the SAME
// pipeline against the source's LATEST raw/data; it is never called
// synchronously from `touchDataset`, keeping slice 1's invariant (c) intact:
// a source edit marks the sheet stale, nothing more, until an intentional
// recalc (auto-mode's debounce or "Recalculate Now") actually runs it.
//
// FREEZE COPY (L0.50) severs the link entirely: a plain, independent dataset
// carrying the derived sheet's CURRENT data, its own `.data.metadata` noting
// where it came from — no `derivedFrom`/`corrections`/`raw`, so it can never
// itself participate in the recalc graph.

import type { ColumnShift } from "../lib/channelRemap";
import type { CorrectionParams, Dataset } from "../lib/types";
import { toast } from "./toasts";
import { miscActions } from "./miscActionsLazy";
import type { AppState } from "./useApp";

export interface DerivedWorksheetsSlice {
  /** Create a linked derived worksheet (L0.50) inside `sourceId`'s workbook:
   *  runs `params` against the source's CURRENT raw/data via the same
   *  corrections API regular corrections use, and commits the result as a
   *  new dataset with `derivedFrom` set. Refuses (zero mutation, via
   *  `setStatus`) when the source doesn't exist or the edge would create a
   *  cycle (K4). Returns the new dataset's id, or null on refusal/failure. */
  createDerivedWorksheet: (
    sourceId: string,
    params: CorrectionParams,
    pipelineLabel?: string,
  ) => Promise<string | null>;
  /** Freeze a derived worksheet's CURRENT data into a permanent, independent
   *  snapshot (L0.50) — a plain dataset with no `derivedFrom`/`corrections`/
   *  `raw`, provenance recorded in `data.metadata.frozenFrom`. Refuses when
   *  `id` isn't a derived worksheet. Returns the new dataset's id, or null.
   *  `activate: false` adds it without retargeting the active dataset, the
   *  selection or the focused plot (a passive Freeze); the default navigates. */
  freezeCopy: (id: string, opts?: { activate?: boolean }) => string | null;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** Re-run a derived worksheet's pipeline (its own `.corrections`) against its
 *  SOURCE's current displayed table — the K5c/K5d "real executor happy
 *  path". Called only from `recalcNow`; never synchronously from
 *  `touchDataset`.
 *
 *  Review round P1-1: the base is `source.data`, NEVER `source.raw`.
 *  `.raw` means "MY OWN pristine pre-correction cache" — correct inside
 *  store/corrections.ts for in-place re-correction, WRONG for a cross-
 *  dataset source reference. L0.50's "source" is the source's CURRENT
 *  displayed table: reading `.raw` here silently discards the source's own
 *  correction pipeline, and for a chain (C derived from B, B itself
 *  derived from A) skips straight past B's entire pipeline to A's raw
 *  value — chains stop composing. A still-pending (lazy, preview-only)
 *  source fails closed rather than deriving from a downsampled preview;
 *  the caller (recalcNow) surfaces this and leaves the sheet stale.
 *
 *  SILENT_STATE_CORRUPTION_PLAN #4 (Class B): `corrected` below is the
 *  SOURCE's own table run through THIS sheet's pipeline — it has never had
 *  THIS sheet's `.formulas` appended, so it must go through the
 *  non-stripping `recomputeFromBase` (lib/formulaInputs.ts), never
 *  `recompute`/`recomputeWithErrors` (useApp.ts/formula.ts). Those STRIP
 *  the last `sheet.formulas.length` columns before reapplying — correct for
 *  a dataset's own `.data` (which already carries its own stale computed
 *  columns) but wrong here, where those trailing columns are REAL source
 *  columns (e.g. the source's own computed column) that were never the
 *  sheet's formulas at all. See derivedWorksheets.test.ts's #4 probe.
 *
 *  Also reports `shift`, the one base column the sheet lost or gained: a
 *  column the source drops (a removed computed column) drops out of the sheet
 *  too and every later column shifts down; one it gains shifts them up. The sheet's own formulas and
 *  channel-indexed fields follow here (store/derivedSheetShift.ts); the caller
 *  remaps the references held outside it (store/columnRemovalRefs.ts). */
export async function recomputeDerivedSheet(
  get: SliceGet,
  sheet: Dataset,
): Promise<{ sheet: Dataset; shift: ColumnShift | null }> {
  const { runDerivedWorksheetRecompute } = await import("./derivedWorksheetsRecompute");
  return runDerivedWorksheetRecompute(get, sheet);
}

// Both actions delegate to `get().addDataset(...)` (the single entry point,
// MAIN_PLAN #9) for the mutation + history entry; `set` is used only by the
// passive Freeze, which must not retarget what the user is looking at.
export function createDerivedWorksheetsSlice(set: SliceSet, get: SliceGet): DerivedWorksheetsSlice {
  return {
    // The body loads on the first call (bundle diet slice 30,
    // plans/BUNDLE_HEADROOM.md): every caller is a gesture that already
    // awaits this promise. A chunk that will not load is reported and
    // creates nothing, the slice-17/28 contract.
    createDerivedWorksheet: async (sourceId, params, pipelineLabel) => {
      let run: typeof import("./derivedWorksheetCreate");
      try {
        run = await import("./derivedWorksheetCreate");
      } catch (e) {
        const msg = `Create derived worksheet failed to load: ${e instanceof Error ? e.message : "error"}`;
        get().setStatus(msg, "danger");
        toast(msg, "danger");
        return null;
      }
      return run.createDerivedWorksheetRun(get, sourceId, params, pipelineLabel);
    },
    freezeCopy: miscActions(set, get).freezeCopy,
  };
}
