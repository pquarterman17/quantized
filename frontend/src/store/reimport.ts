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
// `reimportShapeChanged` decides whether excludedRows/filter/channelRoles/
// channelTypes/formulas are cleared (shape changed — a toast explains why) or
// kept (unchanged shape — formulas just recompute over the new values). The
// clearing patch below only ever WRITES those fields via plain object-literal
// keys (never reads the row-state field by property access), so it never
// needs the #50 guard's allowlist in architecture.test.ts.
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

import {
  applyCorrections as applyCorrectionsApi,
  importFile,
  uploadFile,
  type CorrectionsRequest,
} from "../lib/api";
import { computeDependencyImpact, formatDependencyImpact, hasDependencyImpact } from "../lib/dependencyImpact";
import { hasDesktopShell, pathState } from "../lib/desktopBridge";
import { resetFigureDocumentForReshape } from "../lib/figureDocumentReimport";
import { recomputeData } from "../lib/formula";
import { parentDirectory } from "../lib/importEntry";
import { lit } from "../lib/macro";
import { IMPORT_ACCEPT, openFilePicker } from "../lib/openFilePicker";
import { reimportColumnsChanged, reimportShapeChanged, resolveFreshData } from "../lib/reimport";
import type { DataStruct, Dataset } from "../lib/types";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import { useRelink } from "./relink";
import { toast } from "./toasts";
import type { AppState } from "./useApp";
import { datasetViewDefaults } from "./windows";
import { plotWindowView, syncPlotWindow } from "./windowDocuments";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

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

/** Merge the freshly re-read `freshRaw` into `ds`, re-applying stored
 *  corrections through the SAME API chokepoint `applyCorrections` uses, then
 *  commit ONE atomic store update + macro + touchDataset. */
async function commitReimport(
  set: SliceSet,
  get: SliceGet,
  ds: Dataset,
  freshRaw: DataStruct,
): Promise<void> {
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
  get().recordHistory("re-import dataset");
  // A shape change makes the old channel-keyed VIEW state (keys/styles/labels/
  // order/hidden/errKeys) stale — it indexes the PREVIOUS columns. Reset it to
  // the new shape's smart defaults (the same derivation setActive/addDataset
  // use, re-seeding errKeys/hiddenChannels from the fresh columns) for the live
  // view (if this dataset is active) AND every window bound to it — mirroring
  // the dataset-scoped clear below and removeFormula's window walk. An unchanged
  // shape keeps the view state (the user's styles still apply to the new data).
  const viewReset = shapeChanged ? datasetViewDefaults({ ...ds, data: newData }) : null;
  // A saved editable figure (store/figureLifecycle.ts's `editableFigures`) is
  // neither the live view nor a bound plotWindows entry, so it needs its own
  // reset — lib/figureDocumentReimport.ts mirrors the same field list. Gated
  // on the COLUMN half only: row-only reshapes leave channel bindings
  // provably valid, and a saved document is a durable artifact (see the
  // helper's module doc for why in-range indices are not proof of freshness).
  const columnsChanged = reimportColumnsChanged(ds, freshRaw);
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
        ...(ds.corrections ? { raw: freshRaw } : {}),
        ...(shapeChanged
          ? {
              excludedRows: undefined,
              filter: undefined,
              channelRoles: undefined,
              channelTypes: undefined,
              formulas: undefined,
            }
          : {}),
      };
      return merged.formulas?.length
        ? { ...merged, data: recomputeData(merged.data, merged.formulas) }
        : merged;
    }),
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
    ...(columnsChanged
      ? {
          editableFigures: s.editableFigures.map((document) =>
            document.bindings.datasetId === ds.id
              ? resetFigureDocumentForReshape(document)
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

/** Shared status/toast/error wrapper for both branches of `reimportDataset`
 *  — a rejected `fetchFresh`/`resolveFreshData` leaves `ds` completely
 *  untouched (the exception unwinds before `commitReimport` ever calls
 *  `recordHistory`/`set`). */
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
    await commitReimport(set, get, ds, freshRaw);
    get().setStatus(`re-imported ${ds.name}`);
    toast(`re-imported "${ds.name}"`, "ok");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    get().setStatus(`re-import failed: ${msg}`);
    toast(`re-import "${ds.name}" failed: ${msg}`, "danger");
  }
}

/** Promisify the native file dialog for the no-source fallback — resolves the
 *  FIRST picked file, or never resolves on cancel (the picker's `<input>`
 *  fires no event then; matches every other `openFilePicker` call site in
 *  this codebase, none of which await completion either). */
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
        // "missing" (ok/offline/invalid/unknown, or no bridge at all —
        // every existing browser-mode behavior) falls through to the
        // ordinary reimport unchanged.
        if (hasDesktopShell() && (await pathState(ds.source.path)) === "missing") {
          const msg = `source unavailable — "${ds.name}" (${ds.source.path})`;
          get().setStatus(msg);
          toast(msg, "danger");
          useRelink.getState().openPanel({ oldRoot: parentDirectory(ds.source.path) });
          return;
        }
        await runReimport(set, get, ds, () => importFile(ds.source!.path));
        return;
      }
      // No known source (a browser upload never carries a real path) — the
      // fallback re-opens the picker and merges through the SAME logic; it
      // never sets `source` (an upload still can't know a path).
      const file = await pickOneFile();
      if (!file) return;
      await runReimport(set, get, ds, () => uploadFile(file));
    },
  };
}
