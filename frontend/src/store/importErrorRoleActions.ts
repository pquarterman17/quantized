// The EDIT half of the error-role contract (see `./importErrorRoles` for the
// seed precedence). Split out so the eagerly-loaded import slice
// (`./importDatasetsLazy`) does not drag the Origin-only seeding
// (`lib/originBookRoles`) into the entry chunk; `./importErrorRoles`
// re-exports these for every other caller.

import { inferErrorBindings, type ErrorBinding } from "../lib/errorRoles";
import type { AppState } from "./useApp";
import { syncDatasetWindowDocuments } from "./windowDocuments";

// ── Editing roles after import ───────────────────────────────────────────────
// Kept in THIS module rather than the import slice so the seed above and the
// edits below cannot drift: they are two halves of one contract, and the
// 2026-09-09 review defect (an Inspector edit that never reached an already-
// open plot) was exactly a drift between them.

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export interface ErrorRolesActions {
  /** Replace a dataset's error roles with a DELIBERATE answer -- `[]` means
   *  "checked: none" and is stored literally (Round 7 / O1), never collapsed
   *  to `undefined` (which reads as "never determined" and re-guesses). */
  setErrorRoles: (id: string, roles: readonly ErrorBinding[]) => void;
  /** Re-run name inference ("suggested, never forced"); a null GUESS collapses to `undefined` (re-guessable), unlike `setErrorRoles`. */
  detectErrorRoles: (id: string) => number;
}

export function createErrorRolesActions(set: SliceSet, get: SliceGet): ErrorRolesActions {
  // `exact` (setErrorRoles): store literally, even `[]` -- O1's "checked:
  // none". `!exact` (detectErrorRoles): collapse an empty GUESS to `undefined`.
  const write = (id: string, roles: readonly ErrorBinding[], label: string, exact: boolean) => {
    get().recordHistory(label);
    set((s) => {
      const errorRoles = exact || roles.length ? [...roles] : undefined;
      return {
        datasets: s.datasets.map((d) => (d.id === id ? { ...d, errorRoles } : d)),
        // Code-review fix (2026-09-09, G4 follow-up): `dataset.errorRoles` is
        // the canonical source, but `createWindow` only READS it once, at
        // window-creation time (`createPlotWindowDocument`'s `errors` seed) --
        // any window already bound to this dataset keeps whatever bindings it
        // was seeded with in its OWN `document.bindings.errors`, forever,
        // because `updateFigureDocumentFromPlotView` deliberately preserves a
        // document's non-legacy-expressible ("rich") bindings across every
        // later commit (see that function's `richErrors` filter). A parser-
        // declared X-error binding (NCNR reductus `.refl`, `target: -1`) is
        // exactly such a rich binding, so before this fix, editing/clearing
        // roles here in the Inspector (ErrorRolesCard) silently had NO effect
        // on an already-open plot: `usePlotPayload` renders from the rich
        // document, not the dataset, once one exists (`hasRichErrorBindings`).
        // `syncDatasetWindowDocuments` is the SAME chokepoint
        // `computedColumns.ts` already uses to push a dataset-level error
        // change out to every bound window (not just the focused one --
        // several windows, including background ones, can show one dataset),
        // so this reuses it rather than growing a second, focused-window-only
        // copy of the same rule.
        plotWindows: syncDatasetWindowDocuments(s.plotWindows, id, errorRoles),
      };
    });
  };

  return {
    setErrorRoles: (id, roles) => write(id, roles, "edit error roles", true),

    detectErrorRoles: (id) => {
      const ds = get().datasets.find((d) => d.id === id);
      if (!ds) return 0;
      const found = inferErrorBindings(ds.data, true);
      write(id, found, "detect error roles", false);
      return found.length;
    },
  };
}
