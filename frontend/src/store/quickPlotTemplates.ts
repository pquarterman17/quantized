// Quick Plot template CRUD + apply-delegation (plan PR H3). A sibling slice
// file rather than another method on QuickFigureCreateSlice/GraphBuilderSlice
// -- same "extract a cohesive sibling instead of raising the pin" convention
// store/datasetMeta.ts, store/cellEdit.ts, store/quickFigureCreate.ts, and
// store/rois.ts already follow (useApp.ts has zero line-budget headroom).
//
// `saveQuickPlotTemplate`/`renameQuickPlotTemplate`/`deleteQuickPlotTemplate`
// mirror `store/graphBuilder.ts`'s `savedPlotSpecs` CRUD shape exactly (save
// / rename / delete, each ONE `recordHistory` call). The one deliberate
// divergence: saving under a name that already exists NEVER overwrites --
// L0.31's "Create Figure never saves, overwrites, or changes a Quick Plot
// template automatically" extends to Save-as-Template itself, so a repeat
// save DEDUPES the name (`lib/plotview.ts`'s `dedupeWindowTitle` idiom --
// "X", "X (2)", "X (3)", ...) rather than mutating the existing entry in
// place, unlike `savePlotSpec`'s update-in-place (which only ever fires
// under an explicit `activePlotSpecId` binding a template save has no
// equivalent of).
//
// `applyQuickPlotTemplate` NEVER runs its own create logic -- it resolves
// the template against the live dataset (`lib/quickPlotTemplates.ts`'s pure
// `resolveTemplate`, H4) and, on a match, delegates STRAIGHT to the
// canonical `createQuickFigureFromMapping` (store/quickFigureCreate.ts, G4)
// -- the SAME one-undo-per-gesture figure-creation path Quick Plot and the
// builder's own Create button use. This function itself never calls
// `recordHistory`: the delegate's `createWindow` call is the gesture's only
// history entry (mirrors quickFigureCreate.ts's own header on why that
// matters -- a second entry here would strand the figure after one Undo).

import { dedupeWindowTitle } from "../lib/plotview";
import {
  buildQuickPlotTemplateSignature,
  captureQuickPlotTemplateLabels,
  resolveTemplate,
  type QuickPlotTemplate,
  type QuickPlotTemplateScope,
} from "../lib/quickPlotTemplates";
import { canCreateQuickFigure, type QuickFigureMapping } from "../lib/quickFigureMapping";
import type { QuickPlotStyle } from "../lib/quickFigurePreview";
import { techniqueOf } from "../lib/techniqueDefaults";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

let _templateSeq = 0;
const nextTemplateId = (): string => `qpt-${Date.now().toString(36)}-${++_templateSeq}`;

export interface QuickPlotTemplatesSlice {
  /** Every named saved Quick Plot template (H1). Round-trips through .dwk. */
  quickPlotTemplates: QuickPlotTemplate[];
  /** Explicit save (L0.31: NEVER automatic). Captures the builder's LIVE
   *  (dataset, mapping, style) -- signature + label snapshot + technique are
   *  derived from `dataset` at this moment, same "capture now, re-key
   *  later" discipline as `techniqueViewMemory.captureTechniqueView`. Fails
   *  closed (null, no history entry, no new template) when the dataset has
   *  vanished or the mapping does not pass `canCreateQuickFigure` -- the
   *  SAME gate the Create button and `createQuickFigureFromMapping` use,
   *  because a template that could never itself become a figure is not a
   *  useful thing to save. A duplicate `name` is DEDUPED, never replaces an
   *  existing template (see header). Returns the new template's id. */
  saveQuickPlotTemplate: (
    datasetId: string,
    mapping: QuickFigureMapping,
    style: QuickPlotStyle,
    name: string,
    scope: QuickPlotTemplateScope,
  ) => string | null;
  /** No-op for an unknown id or a blank/unchanged name (mirrors
   *  `renamePlotSpec`). A name collision with another template DEDUPES
   *  (the same `dedupeWindowTitle` discipline `saveQuickPlotTemplate`
   *  uses), never producing two rows under one label. Undoable. */
  renameQuickPlotTemplate: (id: string, name: string) => void;
  /** No-op for an unknown id (mirrors `deletePlotSpec`). Undoable. */
  deleteQuickPlotTemplate: (id: string) => void;
  /** Resolve `templateId` against `datasetId`'s LIVE dataset
   *  (`resolveTemplate`, H4) and, on a match, delegate to
   *  `createQuickFigureFromMapping` -- the ONE canonical create path (never
   *  a second create path, per the frozen contract). Returns false with a
   *  status message and zero mutation on an unknown template/dataset OR a
   *  refused match (naming the unmatched fields) -- refusal, never a
   *  partial apply. */
  applyQuickPlotTemplate: (templateId: string, datasetId: string) => boolean;
}

export function createQuickPlotTemplatesSlice(set: SliceSet, get: SliceGet): QuickPlotTemplatesSlice {
  return {
    quickPlotTemplates: [],

    saveQuickPlotTemplate: (datasetId, mapping, style, name, scope) => {
      const state = get();
      const dataset = state.datasets.find((d) => d.id === datasetId);
      if (!dataset) {
        set({ status: "Save Quick Plot Template unavailable: dataset not found" });
        return null;
      }
      const gate = canCreateQuickFigure(dataset, mapping);
      if (!gate.ok) {
        set({ status: `Save Quick Plot Template unavailable: ${gate.reason}` });
        return null;
      }
      const baseName = name.trim() || "Untitled Quick Plot Template";
      const dedupedName = dedupeWindowTitle(baseName, state.quickPlotTemplates.map((t) => t.name));
      get().recordHistory("Save Quick Plot Template");
      const now = new Date().toISOString();
      const id = nextTemplateId();
      const entry: QuickPlotTemplate = {
        id,
        name: dedupedName,
        createdAt: now,
        modifiedAt: now,
        scope,
        technique: techniqueOf(dataset),
        signature: buildQuickPlotTemplateSignature(dataset),
        mapping,
        style,
        labels: captureQuickPlotTemplateLabels(dataset, mapping),
      };
      set((s) => ({ quickPlotTemplates: [...s.quickPlotTemplates, entry] }));
      return id;
    },

    renameQuickPlotTemplate: (id, name) => {
      const nm = name.trim();
      if (!nm) return;
      const templates = get().quickPlotTemplates;
      const src = templates.find((t) => t.id === id);
      if (!src || src.name === nm) return;
      // Review-round P3(2): the SAME dedupeWindowTitle discipline
      // `saveQuickPlotTemplate` uses -- renaming to a name another template
      // already holds never collides two rows under one label, it dedupes
      // ("Name" -> "Name (2)") instead. Excludes THIS template's own current
      // name from the collision set (renaming "T" to "T" is the no-op above,
      // not a self-collision).
      const otherNames = templates.filter((t) => t.id !== id).map((t) => t.name);
      const dedupedName = dedupeWindowTitle(nm, otherNames);
      get().recordHistory("Rename Quick Plot Template");
      const now = new Date().toISOString();
      set((s) => ({
        quickPlotTemplates: s.quickPlotTemplates.map((t) => (t.id === id ? { ...t, name: dedupedName, modifiedAt: now } : t)),
      }));
    },

    deleteQuickPlotTemplate: (id) => {
      if (!get().quickPlotTemplates.some((t) => t.id === id)) return;
      get().recordHistory("Delete Quick Plot Template");
      set((s) => ({ quickPlotTemplates: s.quickPlotTemplates.filter((t) => t.id !== id) }));
    },

    applyQuickPlotTemplate: (templateId, datasetId) => {
      const state = get();
      const template = state.quickPlotTemplates.find((t) => t.id === templateId);
      if (!template) {
        set({ status: "Quick Plot With unavailable: template not found" });
        return false;
      }
      const dataset = state.datasets.find((d) => d.id === datasetId);
      if (!dataset) {
        set({ status: "Quick Plot With unavailable: dataset not found" });
        return false;
      }
      const resolution = resolveTemplate(template, dataset);
      if (!resolution.ok) {
        set({ status: `Quick Plot With "${template.name}" unavailable: ${resolution.reason}` });
        return false;
      }
      // The ONE canonical create path (G4) -- its own recordHistory is the
      // gesture's only history entry; this function adds none of its own.
      return get().createQuickFigureFromMapping(dataset.id, resolution.mapping, template.style);
    },
  };
}
