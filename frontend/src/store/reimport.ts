// Re-import a dataset from its original source file (MAIN_PLAN #10) — Origin's
// "Re-import Directly": a measurement re-runs, the instrument rewrites the
// same file, and one click refreshes THIS dataset's data in place (id/name/
// tags/group/notes/folder kept) instead of importing a second copy. Composed
// into the ONE useApp store instance exactly like ./windows and ./history
// (read their headers first): `useApp` spreads `createReimportSlice(set,
// get)` into the store.
//
// One entry point, two branches: a dataset with `source.path` re-reads
// through the path-based `/api/parsers/import` route; a source-less one (any
// browser-uploaded import — the File API never exposes a path, see
// lib/types.ts's `Dataset.source` doc for the full "where a path is/isn't
// knowable" matrix) falls back to the file picker (`uploadFile`) — both
// merge the result through the SAME staleness + corrections logic below, so
// the fallback is not a second, divergent code path.
//
// Row/column-index staleness (the #50/#53 precedent — xTrim, installBookData's
// preview->full swap, both in store/useApp.ts): `lib/reimport.ts`'s
// `reimportShapeChanged` (rows OR columns) gates `excludedRows` alone — it is
// the one genuinely ROW-indexed field here, so only a row-count change (or a
// column change, which implies one) invalidates it. `filter`/`channelRoles`/
// `channelTypes`/`formulas`/`errorRoles` are all COLUMN-indexed and clear on
// the narrower `reimportColumnsChanged` alone (Round 7 BLOCKER, adversarial
// review round 2, extended to the rest of the group in a later booked-finding
// pass) — a ROW-only reimport must not wipe any of them; `formulas` in
// particular just recomputes over the fresh rows via the `merged.formulas
// ?.length` branch below, same as an unchanged-shape reimport always did.
// `errorRoles` doesn't just clear on a column change — it RE-DERIVES from
// the fresh `column_designations` via `lib/originBookRoles.ts`'s
// `originBookErrorRoles` (independent-review booked finding), the SAME
// chokepoint the initial-import path uses (#239), so a re-import gets
// exactly the binding a fresh import of the same file would; only a fresh
// file with NO usable designation info at all falls back to `undefined`
// (the label-guesser case). The clearing patch below only ever WRITES those
// fields via plain object-literal keys (never reads the row-state field by
// property access), so it never needs the #50 guard's allowlist in
// architecture.test.ts.
//
// The same staleness applies to a SAVED editable figure
// (store/figureLifecycle.ts's `editableFigures`, added later than this file's
// original staleness handling) — its bindings/view can index the OLD columns
// too. lib/figureDocumentReimport.ts's `resetFigureDocumentForReshape` mirrors
// the live-view/window reset below field-for-field; see its module doc.
//
// Corrections (`Dataset.corrections`/`raw`) re-apply to the FRESH raw through
// the same `applyCorrectionsApi` chokepoint store/useApp.ts's own
// `applyCorrections` action calls — inlined here (not a call to that action)
// so the whole re-import is ONE `recordHistory` entry, not two: undo must
// restore the pre-reimport dataset in a single step.
//
// L0.33 (store/reimportAll.ts, transactional multi-source "Reimport All"):
// the network-calling, no-mutation HALF of a re-import — `computeReimportMerge`
// below — is exported so a multi-source batch can VALIDATE every selected
// source (including re-running its corrections through this SAME chokepoint)
// during its zero-mutation staging phase, then commit every staged result
// through the SAME `applyReimportMerge` this file's own `commitReimport` now
// delegates to. One codepath for "what does re-importing this dataset with
// this fresh data actually do", never a second, divergent one for the batch
// case.

import { applyCorrections as applyCorrectionsApi, importFile, uploadFile, type CorrectionsRequest } from "../lib/api";
import { computeDependencyImpact, formatDependencyImpact, hasDependencyImpact } from "../lib/dependencyImpact";
import { hasDesktopShell, pathState } from "../lib/desktopBridge";
// perf(reimport): lib/figureDocumentReimport.ts is loaded dynamically
// (below, inside computeReimportMerge -- the async staging phase, never
// the synchronous commit) so it never joins the eager bundle; this is a
// TYPE-ONLY import, erased at compile time, giving applyReimportMerge a
// typed reference to the already-resolved function without importing
// the module's VALUE here.
import type { resetFigureDocumentForReshape } from "../lib/figureDocumentReimport";
import { applyFormulas } from "../lib/formula";
import { parentDirectory } from "../lib/importEntry";
import { lit } from "../lib/macro";
import { IMPORT_ACCEPT, openFilePicker } from "../lib/openFilePicker";
import { originBookErrorRoles } from "../lib/originBookRoles";
import { reimportColumnsChanged, reimportShapeChanged, resolveFreshData } from "../lib/reimport";
import type { DataStruct, Dataset } from "../lib/types";
import type { PlotView } from "../lib/plotview";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import type { HistoryBatchToken } from "./history";
import { useRelink } from "./relink";
import { toast } from "./toasts";
import type { AppState } from "./useApp";
import { datasetViewDefaults } from "./windows";
import { plotWindowView, syncPlotWindow } from "./windowDocuments";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** The result of validating a re-import against `ds` — everything
 *  `computeReimportMerge` can determine BEFORE any store mutation, for
 *  `applyReimportMerge` to commit. `newData` is the corrections-applied
 *  data (or `freshRaw` verbatim when `ds` has no corrections); `viewReset`
 *  is `datasetViewDefaults`'s patch, precomputed only when `shapeChanged`
 *  (mirrors the original inline `commitReimport` logic exactly). */
export interface ReimportMerge {
  /** The corrections-applied data to install as `Dataset.data` (verbatim
   *  `freshRaw` when `ds` has no corrections). */
  newData: DataStruct;
  /** The raw re-read data BEFORE corrections — installed as `Dataset.raw`
   *  only when `ds.corrections` is set (mirrors the original inline logic:
   *  a dataset with no corrections has no `.raw` to refresh). */
  freshRaw: DataStruct;
  shapeChanged: boolean;
  columnsChanged: boolean;
  viewReset: Partial<PlotView> | null;
  /** `lib/figureDocumentReimport.ts`'s reset function, already resolved via
   *  a dynamic `import()` during THIS async staging phase (perf: keeps the
   *  module out of the eager bundle) -- `null` when `!columnsChanged`, the
   *  only case `applyReimportMerge` would ever call it. Resolving it here
   *  (not in `applyReimportMerge`) keeps that commit function fully
   *  synchronous, which `store/reimportAllRun.ts`'s batch loop depends on
   *  (see its own module doc: every `applyReimportMerge` call there is
   *  synchronous, back-to-back, for one atomic multi-dataset commit). */
  resetFigureDocumentForReshape: typeof resetFigureDocumentForReshape | null;
}

/** Validate + stage a re-import of `ds` with freshly-read `freshRaw`: re-runs
 *  stored corrections through the SAME `applyCorrectionsApi` chokepoint
 *  `applyCorrections` uses, and computes shape/column-change detection — but
 *  makes NO STORE MUTATION of any kind. A rejected corrections call (a
 *  removed background dataset, a backend validation error) throws and
 *  propagates to the caller untouched, exactly like a rejected `fetchFresh`
 *  above: the caller decides what "validation failed" means for it (a single
 *  reimport's catch-all toast below, or one row of `store/reimportAll.ts`'s
 *  per-source problem report). */
export async function computeReimportMerge(get: SliceGet, ds: Dataset, freshRaw: DataStruct): Promise<ReimportMerge> {
  const shapeChanged = reimportShapeChanged(ds, freshRaw);
  let newData = freshRaw;
  if (ds.corrections) {
    const bg = ds.bgRef && ds.bgRef.datasetId !== ds.id ? await get().resolveDataset(ds.bgRef.datasetId) : undefined;
    const req: CorrectionsRequest = { dataset: freshRaw, params: ds.corrections };
    if (bg) {
      req.bg_dataset = bg.data;
      req.bg_interp = ds.bgRef!.interp;
    }
    newData = await applyCorrectionsApi(req);
  }
  const columnsChanged = reimportColumnsChanged(ds, freshRaw);
  const viewReset = shapeChanged ? datasetViewDefaults({ ...ds, data: newData }) : null;
  // perf(reimport): only fetched when actually needed, during this async
  // staging phase -- never on the synchronous commit path (applyReimportMerge).
  const resetFigureDocumentForReshape = columnsChanged
    ? (await import("../lib/figureDocumentReimport")).resetFigureDocumentForReshape
    : null;
  return { newData, freshRaw, shapeChanged, columnsChanged, viewReset, resetFigureDocumentForReshape };
}

/** Commit an already-staged `merge` (from `computeReimportMerge`) for `ds`:
 *  ONE atomic store update + macro + touchDataset, purely synchronous (every
 *  network round trip already happened in `computeReimportMerge`). `historyToken`
 *  forwards an enclosing `withHistoryBatch`'s token (store/reimportAll.ts's
 *  multi-source commit) so N datasets' worth of these calls fold into ONE
 *  undo entry instead of pushing N; omitted (the single-reimport call site
 *  below), it records its own entry as always. */
export function applyReimportMerge(
  set: SliceSet,
  get: SliceGet,
  ds: Dataset,
  merge: ReimportMerge,
  historyToken?: HistoryBatchToken,
): void {
  const { newData, shapeChanged, columnsChanged, viewReset, resetFigureDocumentForReshape } = merge;
  get().recordHistory("re-import dataset", historyToken);
  // PR M booked finding (G5 canonical-state review): resetFigureDocumentForReshape
  // now clears a stale groupKey (see its module doc) — capture whether any
  // bound figure actually HAD one set, BEFORE the reset, so the toast below
  // only fires when grouping was genuinely lost, never on every reshape.
  const hadGroupedFigure =
    columnsChanged &&
    get().editableFigures.some((doc) => doc.bindings.datasetId === ds.id && doc.bindings.groupKey !== null);
  set((s) => ({
    datasets: s.datasets.map((d) => {
      if (d.id !== ds.id) return d;
      const merged: Dataset = {
        ...d,
        data: newData,
        pending: undefined,
        ...(ds.corrections ? { raw: merge.freshRaw } : {}),
        // A shape change makes ROW-indexed state stale — excludedRows
        // indexes rows that may no longer exist. Clear it; an unchanged row
        // count keeps it (module doc).
        ...(shapeChanged ? { excludedRows: undefined } : {}),
        // Round 7 BLOCKER (adversarial review round 2), extended (booked
        // finding, this pass): filter/channelRoles/channelTypes/formulas are
        // COLUMN-indexed, not row-indexed -- exactly like errorRoles below --
        // but used to be gated on the wider `shapeChanged` (rows OR columns),
        // which wiped every one of them on a harmless "more rows appended"
        // reimport (identical columns). Gated on `columnsChanged` alone
        // instead, matching reimportColumnsChanged's own doc: "channel
        // bindings stay provably valid across a row-only reshape (column
        // meaning is untouched)". `formulas` takes the SAME `merged.formulas
        // ?.length` recompute branch below that an already-unchanged-shape
        // reimport always used -- this only routes the row-only case onto
        // that existing path instead of dropping the formula outright; it
        // recomputes through `applyFormulas`, the ALREADY-BASE variant.
        // `recomputeData` (which strips `formulas.length` trailing columns
        // first) is wrong here and was silently destroying data: every other
        // caller hands it a payload that still carries stale computed
        // columns, but `merged.data` is the freshly RE-READ file, which only
        // ever has BASE columns -- so the strip deleted real measurement
        // data and the formulas then evaluated to null against a column that
        // no longer existed. See reimport.test.ts's data-loss describe. There is
        // still no sanitizeBindings pass on this path to catch a now-invalid
        // index on a genuine column change, unlike the workspaceDatasetParse
        // .dwk load path.
        ...(columnsChanged
          ? {
              filter: undefined,
              channelRoles: undefined,
              channelTypes: undefined,
              formulas: undefined,
              // Independent-review booked finding: a plain `undefined` here
              // threw away a still-derivable Origin-authoritative answer on
              // EVERY column-changing reimport, not just a genuine "no
              // longer exists" case -- `newData` already carries the FRESH
              // `column_designations` (the same source #239's own import
              // path derives from), so re-running `originBookErrorRoles`
              // gets exactly the binding a brand-new import of this SAME
              // file would produce. `?.errorRoles` still collapses to
              // `undefined` when the fresh file has no usable designation
              // info at all (a non-Origin re-import, or a book stripped of
              // its metadata) -- the one case `undefined` genuinely means
              // "not yet determined" and the label-guesser fallback is
              // correct to run. When designations DO exist but none is an
              // error column, `originBookErrorRoles` returns the O1
              // "checked: none" `{ errorRoles: [] }` marker, which survives
              // here as `[]`, not `undefined` -- exactly like the
              // unconditional-clear code this replaces never distinguished.
              errorRoles: originBookErrorRoles(newData)?.errorRoles,
              // SILENT_STATE_CORRUPTION_PLAN #7: fitSpec.yKey/xKey are exactly
              // as column-index-keyed as the fields above, but `yKey` has no
              // honest re-derivation the way errorRoles does -- an in-range-
              // but-now-wrong index would otherwise survive, get refit by
              // `recomputeStaleFits`, and have its saved `params` silently
              // overwritten with a fit of the wrong column.
              fitSpec: undefined,
            }
          : {}),
      };
      return merged.formulas?.length
        ? { ...merged, data: applyFormulas(merged.data, merged.formulas) }
        : merged;
    }),
    // A shape change makes the old channel-keyed VIEW state (keys/styles/
    // labels/order/hidden/errKeys) stale — it indexes the PREVIOUS columns.
    // Reset it to the new shape's smart defaults for the live view (if this
    // dataset is active) AND every window bound to it — mirroring the
    // dataset-scoped clear above and removeFormula's window walk.
    ...(viewReset && s.activeId === ds.id ? viewReset : {}),
    ...(viewReset
      ? {
          plotWindows: s.plotWindows.map((w) =>
            w.datasetId === ds.id
              ? syncPlotWindow(w, { ...plotWindowView(w), ...viewReset }, { resetErrors: true })
              : w,
          ),
        }
      : {}),
    // A saved editable figure (store/figureLifecycle.ts's `editableFigures`)
    // is neither the live view nor a bound plotWindows entry, so it needs
    // its own reset — lib/figureDocumentReimport.ts mirrors the same field
    // list, gated on the COLUMN half only (module doc).
    ...(columnsChanged
      ? {
          // Non-null by construction: computeReimportMerge only resolves
          // `null` when `!columnsChanged` (interface doc).
          editableFigures: s.editableFigures.map((document) =>
            document.bindings.datasetId === ds.id
              ? resetFigureDocumentForReshape!(document)
              : document,
          ),
        }
      : {}),
  }));
  if (shapeChanged) {
    toast(`"${ds.name}" changed shape on re-import — row/column selections were cleared`, "info");
  }
  if (hadGroupedFigure) {
    // PR M booked finding: a clear message instead of a raw backend
    // ValueError at export/preview time (lib/figureSpec.ts's group_col).
    toast(`"${ds.name}" re-import: a figure's grouping column no longer exists — grouping was reset`, "info");
  }
  get().recordMacro(`Re-import "${ds.name}"`, `qz.reimportDataset(${lit(ds.name)})`);
  get().touchDataset(ds.id);
}

export interface ReimportSlice {
  /** Re-read `id`'s data from its `source.path` (a source-less dataset falls
   *  back to the file picker instead). Preserves id/name/tags/group/notes/
   *  folder; clears row/column-indexed state on a shape change (module doc);
   *  re-applies stored corrections; records ONE undo step; touches the
   *  recalc graph. No-op (with a toast) if `id` doesn't exist, the refreshed
   *  file no longer has the dataset's book, or the read/parse fails — the
   *  dataset is left completely untouched on any failure. */
  reimportDataset: (id: string) => Promise<void>;
}

/** Shared status/toast/error wrapper for both branches of `reimportDataset`
 *  — a rejected `fetchFresh`/`resolveFreshData`/`computeReimportMerge` leaves
 *  `ds` completely untouched (the exception unwinds before `applyReimportMerge`
 *  ever calls `recordHistory`/`set`). Inlines `computeReimportMerge` +
 *  `applyReimportMerge` directly (rather than a `commitReimport` middle-man)
 *  — every extra function signature here ships in the always-eager bundle
 *  (this file is part of `useApp`), so the single-dataset path stays as thin
 *  as store/reimportAll.ts's own batch path, which calls the same two
 *  functions separately (stage every source with the first, commit only the
 *  staged ones with the second). */
async function runReimport(
  set: SliceSet,
  get: SliceGet,
  ds: Dataset,
  fetchFresh: () => Promise<DataStruct>,
): Promise<void> {
  try {
    get().setStatus(`re-importing ${ds.name}…`);
    const fresh = await fetchFresh();
    const freshRaw = await resolveFreshData(ds, fresh);
    const merge = await computeReimportMerge(get, ds, freshRaw);
    applyReimportMerge(set, get, ds, merge);
    get().setStatus(`re-imported ${ds.name}`);
    toast(`re-imported "${ds.name}"`, "ok");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    get().setStatus(`re-import failed: ${msg}`);
    toast(`re-import "${ds.name}" failed: ${msg}`, "danger");
  }
}

/** Promisify the native file dialog for the no-source fallback — resolves the
 *  FIRST picked file, or `null` on cancel. DEFECT B fix (Sol audit P1-6,
 *  2026-08-21): this used to document itself as "never resolves on cancel",
 *  because `openFilePicker`'s `<input>` fired no event on Cancel and this is
 *  the ONE call site in the codebase that actually `await`s the result — a
 *  canceled picker left `reimportDataset`'s continuation (the status
 *  cleanup below) permanently suspended. `openFilePicker` now also fires
 *  `onPick([])` on the `<input>`'s `cancel` event, and `files[0] ?? null`
 *  here already turns an empty array into `null` — no other change needed
 *  in this function itself. */
function pickOneFile(): Promise<File | null> {
  return new Promise((resolve) => {
    openFilePicker((files) => resolve(files[0] ?? null), IMPORT_ACCEPT);
  });
}

export function createReimportSlice(set: SliceSet, get: SliceGet): ReimportSlice {
  return {
    reimportDataset: async (id) => {
      const ds = get().datasets.find((d) => d.id === id);
      if (!ds) return;
      // PR M (L0.55): preview the downstream impact BEFORE committing, via
      // the SAME `downstreamOf` closure the recalc engine itself uses —
      // skipped entirely when there's nothing downstream (today's
      // frictionless no-dependents case stays frictionless).
      const impact = computeDependencyImpact(get().datasets, [id]);
      if (hasDependencyImpact(impact)) {
        const ok = await askConfirm(`Re-import "${ds.name}"?`, formatDependencyImpact(impact), "Re-import");
        if (!ok) return;
      }
      if (ds.source) {
        // PR I requirement 4: a workbook pasted from another instance/
        // project (or one whose source drive is simply gone) may name a
        // path this MACHINE can never read, no matter how many times the
        // backend is asked. Probing first (only possible with a desktop
        // bridge — see pathState's own "unknown, never guessed missing"
        // doc) turns that into an honest "Source unavailable" + the LANDED
        // P1.7 Relink Source path, instead of a raw backend import error
        // that leaves the user nowhere to go. Anything short of a CONFIRMED
        // "missing"/"offline" (ok/invalid/unknown, or no bridge at all —
        // every existing browser-mode behavior) falls through to the
        // ordinary reimport unchanged.
        //
        // DEFECT C fix (Sol audit P1-6, 2026-08-21): "offline" (the volume
        // itself is unreachable — desktop_source_probe.py's
        // FileNotFoundError-but-volume-absent branch) used to fall through
        // here too, past the check above (only "missing" was tested), and
        // land on the ordinary reimport — which then failed with a raw
        // "re-import failed: <fetch error>" toast instead of the same
        // honest Relink recovery a confirmed-missing source gets.
        // RelinkPanel/lib/reopenRecent.ts already treat offline as its own
        // distinct, non-destructive state ("the file is probably fine, the
        // share is just not mounted" — reopenRecent.ts's own module doc);
        // this is the one flow that had not caught up.
        if (hasDesktopShell()) {
          const state = await pathState(ds.source.path);
          if (state === "missing" || state === "offline") {
            const msg =
              state === "offline"
                ? `source volume unreachable — reconnect the drive/network and retry, or relink "${ds.name}"`
                : `source unavailable — "${ds.name}" (${ds.source.path})`;
            get().setStatus(msg);
            toast(msg, "danger");
            useRelink.getState().openPanel({ oldRoot: parentDirectory(ds.source.path) });
            return;
          }
        }
        await runReimport(set, get, ds, () => importFile(ds.source!.path));
        return;
      }
      // No known source (a browser upload never carries a real path) — the
      // fallback re-opens the picker and merges through the SAME logic; it
      // never sets `source` (an upload still can't know a path).
      //
      // DEFECT B fix (Sol audit P1-6, 2026-08-21): a canceled picker now
      // resolves `null` (pickOneFile's doc) instead of hanging forever, so
      // this settles quietly — a brief status, no toast, no import attempt —
      // rather than leaving the earlier "re-importing …" status stuck on
      // screen with nothing ever following it up.
      const file = await pickOneFile();
      if (!file) {
        get().setStatus("re-import canceled");
        return;
      }
      await runReimport(set, get, ds, () => uploadFile(file));
    },
  };
}
