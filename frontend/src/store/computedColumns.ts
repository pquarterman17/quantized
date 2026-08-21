// Worksheet computed-column authoring (addFormula/removeFormula/updateFormula)
// — extracted out of useApp.ts under the store-size ratchet
// (architecture.test.ts's STORE_PINS) exactly like store/corrections.ts /
// store/cellEdit.ts: useApp.ts sits AT its pin, so a self-contained feature's
// actions live here instead of inline. This slice owns no state of its own —
// `datasets` stays a plain field on the composed AppState — it mutates it
// through `set`/`get` the same way store/corrections.ts does.
//
// LIBRARY_WORKBOOK_UX_PLAN PR K (K1/K2/K4/K5b): every write here that would
// create or change a column→column dependency edge is checked with
// `lib/recalc.ts`'s `wouldCreateCycle` FIRST — a rejected write REFUSES via
// `setStatus` with zero mutation (no `recordHistory`, no `set()`). A column's
// `deps` (K1's `referencedColumns`) and its live `formulaErrors` (K5b) are
// captured on every write, not just at creation, so an edit that fixes (or
// breaks) a formula keeps both in sync.

import { applyFormulas, baseColumns, channelLetter, formulaErrors, referencedColumns } from "../lib/formula";
import { remapSurvivingFormulas } from "../lib/formulaRename";
import { lit } from "../lib/macro";
import { recalcNodes, wouldCreateCycle } from "../lib/recalc";
import type { ComputedColumn, DataStruct } from "../lib/types";
import { remapDatasetChannels, remapViewChannels, remapWindowViews } from "../lib/channelRemap";
import { syncDatasetWindowDocuments } from "./windowDocuments";
import type { AppState } from "./useApp";

export interface ComputedColumnsSlice {
  // Append a computed column (formula) to a dataset and evaluate it. The
  // column lands as the last column of `data` and recomputes whenever the
  // base changes. Strips the OLD computed columns first, then reapplies the
  // grown list. Returns false (zero mutation) when the formula's own
  // dependencies would create a cycle (K4) — the ONLY way that can happen
  // for a brand-new column is a direct self-reference, since a column's
  // channel-letter identity doesn't exist until this call assigns it.
  addFormula: (id: string, name: string, expr: string) => boolean;
  // Remove the computed column at `index` (in the formulas list). Strips the
  // OLD computed columns, then reapplies the shrunk list (NaN-stable indices).
  removeFormula: (id: string, index: number) => void;
  // Edit an existing computed column's name/expr/unit in place (K4's
  // "updateFormula" authoring path). A real cycle risk here (unlike
  // addFormula): a LATER column may already depend on this one, so widening
  // this column's own deps to reference that later column closes a loop.
  updateFormula: (id: string, index: number, patch: { name?: string; expr?: string; unit?: string }) => boolean;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** The channel letter a dataset's `index`-th formula occupies (LIBRARY_
 *  WORKBOOK_UX_PLAN PR K): formulas are appended positionally after every
 *  base column, in list order — see `lib/formula.ts`'s module header.
 *  Exported for tests: the cycle check resolves deps by LETTER, not by a
 *  formula's display `name`, so a regression test must compute the real
 *  letter a new/edited column will occupy rather than guess. */
export function formulaLetter(baseLabelCount: number, formulaCount: number, index: number): string {
  const baseCount = Math.max(0, baseLabelCount - formulaCount);
  return channelLetter(baseCount + index);
}

/** Recompute a dataset's `data` + `formulaErrors` from a freshly-built
 *  formula list, given its (already stripped) base columns — the one place
 *  this slice folds both together so they can never disagree. Exported for
 *  store/recode.ts (J2): committing a recode column appends to `formulas`
 *  the SAME way addFormula does, so it reuses this instead of re-deriving
 *  the pair by hand. */
export function withRecomputedFormulas(
  base: DataStruct,
  formulas: ComputedColumn[],
): { data: DataStruct; formulaErrors: Record<string, string> | undefined } {
  const data = applyFormulas(base, formulas);
  const errors = formulaErrors(base, formulas);
  return { data, formulaErrors: Object.keys(errors).length ? errors : undefined };
}

/** `withRecomputedFormulas`, plus `forced` merged in (winning over whatever
 *  `lib/formula.ts`'s own evaluation independently produced) — `removeFormula`
 *  (DEFECT A, Sol audit P1-3) uses this so a forced "references removed
 *  column X" message is never masked by a generic "unknown variable" one. */
function withRecomputedFormulasAnd(
  base: DataStruct,
  formulas: ComputedColumn[],
  forced: Record<string, string>,
): { data: DataStruct; formulaErrors: Record<string, string> | undefined } {
  const recomputed = withRecomputedFormulas(base, formulas);
  if (!Object.keys(forced).length) return recomputed;
  return { data: recomputed.data, formulaErrors: { ...(recomputed.formulaErrors ?? {}), ...forced } };
}

export function createComputedColumnsSlice(set: SliceSet, get: SliceGet): ComputedColumnsSlice {
  return {
    addFormula: (id, name, expr) => {
      const ds = get().datasets.find((d) => d.id === id);
      if (!ds) return false;
      const deps = referencedColumns(expr).letters;
      const target = formulaLetter(ds.data.labels.length, ds.formulas?.length ?? 0, ds.formulas?.length ?? 0);
      for (const dep of deps) {
        const reason = wouldCreateCycle(get().datasets, {
          from: recalcNodes.column(id, dep),
          to: recalcNodes.column(id, target),
        });
        if (reason) {
          get().setStatus(`Can't add column "${name}": ${reason}`);
          return false;
        }
      }
      get().recordHistory("add column");
      set((s) => ({
        datasets: s.datasets.map((d) => {
          if (d.id !== id) return d;
          const base = baseColumns(d.data, d.formulas?.length ?? 0);
          const formulas: ComputedColumn[] = [...(d.formulas ?? []), { name, expr, deps }];
          return { ...d, formulas, ...withRecomputedFormulas(base, formulas) };
        }),
      }));
      get().recordMacro(`Add column ${name}`, `qz.addColumn(${lit(name)}, ${lit(expr)})`, {
        kind: "expression",
        params: { name, expr },
      });
      get().touchDataset(id); // recalc graph (#1): data changed
      return true;
    },
    updateFormula: (id, index, patch) => {
      const ds = get().datasets.find((d) => d.id === id);
      const current = ds?.formulas?.[index];
      if (!ds || !current) return false;
      const name = patch.name?.trim() || current.name;
      const expr = patch.expr ?? current.expr;
      const unit = patch.unit ?? current.unit;
      const deps = referencedColumns(expr).letters;
      const target = formulaLetter(ds.data.labels.length, ds.formulas!.length, index);
      for (const dep of deps) {
        const reason = wouldCreateCycle(get().datasets, {
          from: recalcNodes.column(id, dep),
          to: recalcNodes.column(id, target),
        });
        if (reason) {
          get().setStatus(`Can't update column "${current.name}": ${reason}`);
          return false;
        }
      }
      get().recordHistory("edit column");
      set((s) => ({
        datasets: s.datasets.map((d) => {
          if (d.id !== id || !d.formulas) return d;
          const base = baseColumns(d.data, d.formulas.length);
          const formulas = d.formulas.map((f, i): ComputedColumn =>
            i === index ? { name, expr, ...(unit ? { unit } : {}), deps } : f,
          );
          return { ...d, formulas, ...withRecomputedFormulas(base, formulas) };
        }),
      }));
      get().recordMacro(`Edit column ${name}`, `qz.editColumn(${lit(name)}, ${lit(expr)})`, {
        kind: "expression",
        params: { name, expr },
      });
      get().touchDataset(id); // recalc graph (#1): data changed
      return true;
    },
    // Computed columns are the LAST formulas.length value columns, in order,
    // so the removed one is column (baseCount + index) and every later
    // column shifts down by one. BOTH halves of the index-keyed state have
    // to follow it -- the dataset-scoped roles/types/filter AND the live
    // view's xKey/yKeys/styles/hidden/errKeys. See lib/channelRemap.ts for
    // why the view half was missing until 2026-07-19.
    removeFormula: (id, index) => {
      get().recordHistory("remove column");
      const target = get().datasets.find((d) => d.id === id);
      if (!target?.formulas) return;
      const removedCol = baseColumns(target.data, target.formulas.length).labels.length + index;
      set((s) => {
        const datasets = s.datasets.map((d) => {
          if (d.id !== id || !d.formulas) return d;
          const base = baseColumns(d.data, d.formulas.length);
          const survivors = d.formulas.filter((_, i) => i !== index);
          // DEFECT A (Sol audit P1-3): a surviving formula's expr/deps (or a
          // recode's sourceLetter) resolve column letters POSITIONALLY, so
          // every reference past `removedCol` must shift down WITH it, and
          // any reference straight AT it must become an explicit error —
          // never silently re-point at whatever shifted into that letter.
          const { formulas, forcedErrors } = remapSurvivingFormulas(survivors, removedCol);
          return {
            ...d,
            formulas: formulas.length ? formulas : undefined,
            ...withRecomputedFormulasAnd(base, formulas, forcedErrors),
            ...remapDatasetChannels(d, removedCol),
          };
        });
        const remappedWindows = remapWindowViews(s.plotWindows, id, removedCol);
        const remappedDataset = datasets.find((dataset) => dataset.id === id);
        return {
          datasets,
          ...(s.activeId === id ? remapViewChannels(s, removedCol) : {}),
          plotWindows: syncDatasetWindowDocuments(remappedWindows, id, remappedDataset?.errorRoles),
        };
      });
      get().touchDataset(id); // recalc graph (#1): data changed
    },
  };
}
