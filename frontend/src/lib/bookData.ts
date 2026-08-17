// Single-flight lazy-book resolution (ORIGIN_FILE_DECODE_PLAN #38) —
// extracted from store/useApp.ts under its size ratchet (the #152/#153
// merge landed the store 2 lines over the 2818 pin; this module is the
// "extract a slice, never raise the pin" answer). Pure lib: the store
// setter comes in as a parameter, so there's no store import and no cycle.

import { fetchBookData } from "./api";
import type { BookSource, Dataset } from "./types";

/** The narrow slice of the store's `set` this module needs — an updater
 *  over `datasets` only, structurally compatible with Zustand's `set`. */
type DatasetsSetter = (fn: (s: { datasets: Dataset[] }) => { datasets: Dataset[] }) => void;

/** In-flight lazy-book fetches, single-flight and keyed by dataset id — a
 *  book bound into two places at once (e.g. two plot windows) triggers
 *  exactly one HTTP fetch. Module scope, not store state: a Promise has no
 *  business flowing through Zustand subscribers or (accidentally) a .dwk
 *  serialize. */
const _bookFetches = new Map<string, Promise<void>>();

/** Fetch one dataset's full data and install it, single-flight. Resolves
 *  (not rejects) once the swap lands — `ensureBookData` (fire-and-forget UI
 *  trigger) attaches its own `.catch` for the toast; `resolvePendingDatasets`
 *  (the .dwk pre-save resolver) awaits the SAME promise and lets a failure
 *  propagate so the caller can abort the save. */
export function installBookData(set: DatasetsSetter, id: string, source: BookSource): Promise<void> {
  const inFlight = _bookFetches.get(id);
  if (inFlight) return inFlight;
  const p = fetchBookData(source)
    .then((full) => {
      set((s) => ({
        datasets: s.datasets.map((d) =>
          d.id === id
            ? {
                ...d,
                data: full,
                pending: undefined,
                // Row-state indices were against the PREVIEW rows (#50/#53)
                // — they no longer mean anything against the real data.
                excludedRows: undefined,
                filter: undefined,
              }
            : d,
        ),
      }));
    })
    .finally(() => {
      _bookFetches.delete(id);
    });
  _bookFetches.set(id, p);
  return p;
}
