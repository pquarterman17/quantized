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
import { recomputeData } from "../lib/formula";
import { lit } from "../lib/macro";
import { IMPORT_ACCEPT, openFilePicker } from "../lib/openFilePicker";
import { reimportShapeChanged, resolveFreshData } from "../lib/reimport";
import type { DataStruct, Dataset } from "../lib/types";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

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
  }));
  if (shapeChanged) {
    toast(`"${ds.name}" changed shape on re-import — row/column selections were cleared`, "info");
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
      if (ds.source) {
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
