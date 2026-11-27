// The removeFormula body, split out of store/computedColumns.ts (bundle diet
// slice 35, `plans/BUNDLE_HEADROOM.md`). Only the lazy worksheet removes a
// computed column, so the positional-letter rewrite of the surviving formulas
// (lib/formulaRename.ts), the channel remap (lib/channelRemap.ts) and the
// figure/window/graph holders' shift (store/columnRemovalRefs.ts) load with it
// on demand. store/removeFormulaLazy.ts is the eager proxy; it loads this
// module the way store/cellEdit.ts loads store/cellEditRun.ts.

import { baseColumns } from "../lib/formula";
import { remapDatasetChannels } from "../lib/channelRemap";
import { remapSurvivingFormulas } from "../lib/formulaRename";
import { columnRemovalRefsPatch } from "./columnRemovalRefs";
import { refreshFitRefsLater, refuseLinkedGraph, withRecomputedFormulasAnd, type ComputedColumnsSlice } from "./computedColumns";
import { resolvePendingEdit } from "./pendingEdit";
import type { Dataset } from "../lib/types";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createRemoveFormulaSlice(set: SliceSet, get: SliceGet): Pick<ComputedColumnsSlice, "removeFormula"> {
  return {
    // Computed columns are the LAST formulas.length value columns, in order,
    // so the removed one is column (baseCount + index) and every later
    // column shifts down by one. BOTH halves of the index-keyed state have
    // to follow it -- the dataset-scoped roles/types/filter AND the live
    // view's xKey/yKeys/styles/hidden/errKeys. See lib/channelRemap.ts for
    // why the view half was missing until 2026-07-19.
    removeFormula: (id, index) => {
      // P2-2 (Sol's Day-6 audit): existence check moved BEFORE recordHistory
      // -- a missing dataset/no-formulas id must not push a phantom undo
      // entry. Minimal reorder only (no other restructuring), per the
      // concurrent edit on claude/audit-positional-columns touching this
      // function's body.
      const target = get().datasets.find((d) => d.id === id);
      if (!target?.formulas?.[index]) return;
      if (refuseLinkedGraph(get, target)) return;
      if (resolvePendingEdit(get, target, "removing a column", () => {
        const current = get().datasets.find((d) => d.id === id);
        if (!current?.formulas?.[index]) return false;
        get().removeFormula(id, index);
      })) return;
      get().recordHistory("remove column");
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
          const next: Dataset = {
            ...d,
            formulas: formulas.length ? formulas : undefined,
            ...withRecomputedFormulasAnd(base, formulas, forcedErrors),
          };
          return { ...next, ...remapDatasetChannels(next, removedCol) }; // from `next`: the notes remap returns `data`
        });
        // Every holder outside the dataset (windows, saved/legacy figures,
        // saved graph specs, the live view) — shared with the derived-sheet
        // recalc, whose columns shift when its source loses one.
        return { datasets, ...columnRemovalRefsPatch(s, id, removedCol, datasets) };
      });
      get().touchDataset(id); // recalc graph (#1): data changed
      refreshFitRefsLater(id, get); // P2.5: removing the fit's own column drops the fit (remapFitSpec)
    },
  };
}
