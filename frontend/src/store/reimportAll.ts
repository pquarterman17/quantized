// L0.33 (LIBRARY_WORKBOOK_UX_PLAN item 13, PR M) — transactional multi-source
// reimport: "Reimport All validates and stages every selected source before
// changing the combined workbook. If a required source fails, leave the
// workbook unchanged and report each problem. Reimport Available Sources is
// a separate explicit action for an intentional partial update." Composed
// into the ONE useApp store instance exactly like ./reimport (read its
// header first) — split into its own sibling module per this file's own
// size budget (store/reimport.ts is close enough to its 500-line ceiling
// that this addition earns the same "extract a sibling" treatment
// store/relinkBrowse.ts got out of store/relink.ts).
//
// TWO-PHASE, never one: `stageReimportAll` (phase 1) probes + fully parses/
// validates EVERY requested dataset via store/reimport.ts's `computeReimportMerge`
// — the SAME network chokepoint (probe → importFile → resolveFreshData →
// corrections) a single reimport uses — into `reimportAllRows`, making ZERO
// mutation of `datasets` or any other participating field. `commitReimportAll`
// (phase 2) is the only thing that ever calls `set()` on real data: `"all"`
// refuses outright (zero mutation, rows updated in place so the dialog shows
// every problem) the moment ANY row isn't cleanly `"staged"`; `"available"`
// commits exactly the staged subset. Both modes route every committed row
// through `applyReimportMerge` inside ONE `withHistoryBatch` — one undo
// entry for the whole operation, matching store/relink.ts's `commit()` and
// store/workbookSeparate.ts's `commitSeparateWorksheets` precedent.
//
// Fail-closed re-validation at commit (the R3 `guardVerdict` precedent,
// store/relink.ts's `commit()`): a staged row's own remembered `dsRef` is
// NEVER trusted as the verdict of record. `commitReimportAll` looks up the
// LIVE dataset by id and requires OBJECT IDENTITY against `dsRef` — the
// exact `Dataset` this row was staged against, captured synchronously
// BEFORE `stageReimportAll`'s first `await`. Since every store mutation is
// immutable (a new `Dataset` object on every edit — cell edit, tag, an
// unrelated reimport, a relink, removal), ANY edit landing on that dataset
// between stage and commit changes its identity and this check catches it —
// not just a source-path swap, every concurrent edit to that one row fails
// closed. A dataset removed outright fails the same way (no live entry at
// all). This is deliberately COARSER than store/relink.ts's `.source`-only
// identity check: relink only ever rewrites `.source`, but a reimport
// installs fresh `.data`, so anything touching this dataset at all — not
// just its provenance — must invalidate a staged merge computed against the
// pre-edit shape.
//
// Sequence guard (the XrayTab.tsx `applyEnergyAsWavelength` #143 precedent —
// a monotonic request id, never a boolean): `stageReimportAll` mints a fresh
// generation on every call and only the LATEST one's results are ever
// written to `reimportAllRows` — an earlier, still-in-flight call whose
// promises resolve late (a second overlapping invocation) is silently
// discarded rather than clobbering a newer stage (or a commit already in
// progress against it).
//
// EAGER BUNDLE SIZE: this file is composed into the always-loaded `useApp`
// store, so every byte here ships on first paint. ALL of the real logic
// (every branch of "what can go wrong", the identity re-validation, the
// transactional commit) lives in ./reimportAllRun instead, loaded via a
// dynamic `import()` the moment either action below actually runs — it only
// ever executes after an explicit, rare "Reimport All" gesture, so it has
// no business in the eager chunk. This file keeps ONLY state + a one-line
// trampoline per action (never touch scripts/check-bundle-size.mjs's budget
// to buy this feature room instead of splitting it — if this file grows
// again, move the growth to reimportAllRun.ts, not here).

import type { Dataset } from "../lib/types";
import type { ReimportMerge } from "./reimport";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** Every terminal state one selected source can land in after staging (or
 *  after commit's own re-validation). Only `"staged"` rows ever commit. */
export type ReimportAllOutcome =
  | "staged"
  | "no_source" // browser upload with no recorded path -- re-import it individually instead
  | "missing" // desktop-bridge-confirmed absent (never guessed without a bridge)
  | "offline" // desktop-bridge-confirmed volume unreachable
  | "parse_error" // import/resolveFreshData/corrections rejected -- message carries why
  | "removed" // the dataset no longer exists (gone before staging, or between stage and commit)
  | "changed"; // the dataset was edited by something else between stage and commit

export interface ReimportAllRow {
  datasetId: string;
  datasetName: string;
  sourcePath: string | null;
  outcome: ReimportAllOutcome;
  /** Human-readable reason, always present — the per-source line the
   *  problem report renders (L0.33: "report each problem"). */
  message: string;
  /** The exact `Dataset` object this row validated against, captured at the
   *  START of staging (module doc) — present only while `outcome ===
   *  "staged"`. Never read for anything but the commit-time identity guard. */
  dsRef?: Dataset;
  /** The staged merge `applyReimportMerge` commits — present only while
   *  `outcome === "staged"`. */
  merge?: ReimportMerge;
}

export interface ReimportAllSlice {
  /** Non-null while a Reimport All / Reimport Available Sources report is
   *  open (staging in progress or finished) — one row per requested dataset
   *  id, in request order. Transient dialog state, never undoable
   *  (architecture.test.ts's HISTORY_EXCLUDED, same class as
   *  `separatePreview`). */
  reimportAllRows: ReimportAllRow[] | null;
  /** True while `stageReimportAll` has a network round trip in flight. */
  reimportAllBusy: boolean;
  /** Phase 1: probe + fully parse/validate every id in `datasetIds` into
   *  `reimportAllRows`, making NO mutation of `datasets` or any other
   *  participating field. De-duplicates `datasetIds`. A superseded (stale)
   *  invocation writes nothing (module doc's sequence guard). */
  stageReimportAll: (datasetIds: readonly string[]) => Promise<void>;
  /** Phase 2: re-validate every staged row's identity against the LIVE
   *  store (module doc), then commit. `"all"` commits only when EVERY row
   *  re-validates as `"staged"` — otherwise it makes NO mutation and just
   *  refreshes `reimportAllRows` with the re-validated problem list.
   *  `"available"` always commits the staged subset (zero staged rows is a
   *  no-op toast, not a mutation either). A successful commit closes the
   *  report (`reimportAllRows: null`). No-op while `reimportAllBusy`, or
   *  when no report is open. */
  commitReimportAll: (mode: "all" | "available") => Promise<void>;
}

export function createReimportAllSlice(set: SliceSet, get: SliceGet): ReimportAllSlice {
  // Monotonic request id (module doc's sequence guard), threaded into
  // ./reimportAllRun by reference so ITS logic can bump/read it while this
  // cell itself stays in the always-loaded slice — a closure variable, same
  // idiom as store/history.ts's activeBatchToken: read/written only by this
  // one slice's own async handshake, never reactive state, so it needs no
  // architecture.test.ts HISTORY_EXCLUDED entry.
  const genRef = { current: 0 };

  return {
    reimportAllRows: null,
    reimportAllBusy: false,
    stageReimportAll: async (datasetIds) => {
      const { runStage } = await import("./reimportAllRun");
      await runStage(set, get, datasetIds, genRef);
    },
    commitReimportAll: async (mode) => {
      const { runCommit } = await import("./reimportAllRun");
      await runCommit(set, get, mode);
    },
  };
}
