// Error-column roles, end to end: which ones a freshly imported dataset GETS
// and from where, plus the actions that EDIT them afterwards.
//
//
// Extracted from importDatasets.ts (which had reached the 500-line module
// ceiling) because the three sources form one cohesive decision with a
// PRECEDENCE that was previously only implicit in an inline `??` chain. Naming
// it makes the ranking reviewable, and gives the ordering one place to be
// documented and tested.
//
// The order, most authoritative first:
//   1. Origin's own column designations (`lib/originBookRoles`) — the file
//      stating a column IS a Y-error. Never overridden by a guess.
//   2. A PARSER's declaration for its own format
//      (`DataStruct.metadata["error_roles"]`) — the parser knows the layout;
//      see `quantized.io.ncnr`'s reductus triple (BUGS_AND_ISSUES BUG-001).
//   3. The label guesser (`lib/errorRoles.inferErrorBindings`) — spelling
//      conventions only, and only where the pairing is defensible.
// Nothing inferable at all yields NO key, so an ordinary numeric file carries
// no empty role list (the `[]` value is meaningful — see originBookRoles' O1).

import { inferErrorBindings, sanitizeBindings, type ErrorBinding } from "../lib/errorRoles";
import { originBookErrorRoles } from "../lib/originBookRoles";
import type { AppState } from "./useApp";
import { syncDatasetWindowDocuments } from "./windowDocuments";
import type { DataStruct } from "../lib/types";

/** Roles a PARSER declared for its own format, via
 *  `DataStruct.metadata["error_roles"]` (the contract
 *  `quantized.io.import_error_bindings.binding_metadata` writes, and which
 *  `io/ncnr.py` uses for the reductus measured/uncertainty/resolution triple).
 *
 *  This is the reader that side of the contract was missing: the key was
 *  written and documented as backend-only, so a parser that knew an error
 *  column's role could not get bars onto a plot (BUGS_AND_ISSUES BUG-001).
 *
 *  It outranks `importRoles`'s label guess — a parser knows its format, the
 *  guesser only knows spellings — but is still ranked BELOW Origin's own
 *  column designations, which are the file's explicit statement of role.
 *
 *  The metadata comes from a parsed FILE, so it is validated rather than
 *  trusted — through `lib/errorRoles.sanitizeBindings`, the SAME validator the
 *  `.dwk`/template read-back path uses. A review of an earlier draft found this
 *  function carrying its own stricter copy of those rules, which meant a
 *  self-targeting binding was rejected here but accepted on reload; the strict
 *  rules moved into the shared validator instead.
 *
 *  Returns `null` (not `{}`) when nothing survives, so the `??` chain falls
 *  through to the guesser exactly as it did before — an unrecognised or
 *  malformed hint must not silently suppress inference. */
function parserErrorRoles(data: DataStruct): { errorRoles: ErrorBinding[] } | null {
  const roles = sanitizeBindings((data.metadata ?? {})["error_roles"], data.labels?.length ?? 0);
  return roles?.length ? { errorRoles: roles } : null;
}

/** Seed the canonical error-column roles from the parsed labels (MAIN #33).
 *
 *  Inference SUGGESTS — it only binds where the pairing is unambiguous or
 *  follows the instrument convention, and everything stays overridable. Omitted
 *  entirely when nothing is inferable, so an ordinary two-column file carries
 *  no empty role list. */
function importRoles(data: DataStruct): { errorRoles?: ErrorBinding[] } {
  const roles = inferErrorBindings(data);
  return roles.length ? { errorRoles: roles } : {};
}

/** The seeded roles for a newly imported dataset, by the precedence documented
 *  at the top of this module. Spread into the `Dataset` under construction. */
export function seedErrorRoles(data: DataStruct): { errorRoles?: ErrorBinding[] } {
  return originBookErrorRoles(data) ?? parserErrorRoles(data) ?? importRoles(data);
}

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
      const found = inferErrorBindings(ds.data);
      write(id, found, "detect error roles", false);
      return found.length;
    },
  };
}
