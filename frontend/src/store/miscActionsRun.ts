// The bodies of seven slice actions that only lazy chunks call (bundle diet
// slice 37, `plans/BUNDLE_HEADROOM.md`), moved verbatim out of the entry chunk:
// Freeze Copy (store/derivedWorksheets.ts), Separate's commit
// (store/workbookSeparate.ts), Combine (store/workbookCombine.ts), Open figure
// document in a window (store/reportsFigureDocs.ts) and the Quick Plot
// template save, duplicate and apply (store/quickPlotTemplates.ts).
// store/miscActionsLazy.ts is the eager proxy; each slice keeps its interface
// and its doc comments.

import { cloneDataStruct } from "../lib/dataset";
import { lit } from "../lib/macro";
import { dedupeWindowTitle, displayedWindowTitle } from "../lib/plotview";
import { plotIntentStageTab } from "../lib/stagetab";
import { dedupeWorksheetNames, resolveCombineTargets } from "../lib/workbookCombine";
import type { WorkbookNode } from "../lib/workbooks";
import {
  buildQuickPlotTemplateSignature,
  captureQuickPlotTemplateLabels,
  resolveTemplate,
  type QuickPlotTemplate,
} from "../lib/quickPlotTemplates";
import { canCreateQuickFigure } from "../lib/quickFigureMapping";
import { techniqueOf } from "../lib/techniqueDefaults";
import type { Dataset } from "../lib/types";
import type { DerivedWorksheetsSlice } from "./derivedWorksheets";
import { nextDatasetId } from "./idSeq";
import { recordRecipeUse } from "./recordRecipeUse";
import { toast } from "./toasts";
import type { QuickPlotTemplatesSlice } from "./quickPlotTemplates";
import type { ReportsFigureDocsSlice } from "./reportsFigureDocs";
import type { AppState } from "./useApp";
import { withWindowDocumentErrors } from "./windowDocuments";
import type { WorkbookCombineSlice } from "./workbookCombine";
import { nextWorkbookId } from "./workbookIds";
import type { WorkbookSeparateSlice } from "./workbookSeparate";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export type MiscActionsRun = Pick<DerivedWorksheetsSlice, "freezeCopy"> &
  Pick<WorkbookSeparateSlice, "commitSeparateWorksheets"> &
  Pick<WorkbookCombineSlice, "combineWorkbooks"> &
  Pick<ReportsFigureDocsSlice, "openFigureDocInWindow"> &
  Pick<QuickPlotTemplatesSlice, "saveQuickPlotTemplate" | "duplicateQuickPlotTemplate" | "applyQuickPlotTemplate">;

let _templateSeq = 0;
const nextTemplateId = (): string => `qpt-${Date.now().toString(36)}-${++_templateSeq}`;

export function createMiscActionsRun(set: SliceSet, get: SliceGet): MiscActionsRun {
  return {
    freezeCopy: (id, opts) => {
      const src = get().datasets.find((d) => d.id === id);
      if (!src?.derivedFrom) {
        get().setStatus("Freeze Copy is only available for a derived worksheet.");
        return null;
      }
      const data = cloneDataStruct(src.data);
      data.metadata = {
        ...data.metadata,
        frozenFrom: {
          datasetId: src.id,
          datasetName: src.name,
          sourceId: src.derivedFrom.datasetId,
          pipeline: src.derivedFrom.pipeline,
          frozenAt: new Date().toISOString(),
        },
      };
      const frozen: Dataset = {
        id: nextDatasetId(),
        name: `${src.name} (frozen)`,
        data,
        ...(src.notes ? { notes: src.notes } : {}),
        ...(src.tags?.length ? { tags: [...src.tags] } : {}),
        ...(src.workbookId ? { workbookId: src.workbookId } : {}),
        ...(src.folderId ? { folderId: src.folderId } : {}),
      };
      if (opts?.activate === false) {
        get().recordHistory("add dataset"); // still ONE undo step, like addDataset
        set((s) => ({ datasets: [...s.datasets, frozen] }));
      } else {
        get().addDataset(frozen); // single entry point (MAIN_PLAN #9) — one history entry
      }
      get().recordMacro(`Freeze Copy of ${src.name}`, `qz.freezeCopy(${lit(src.name)})`, {
        kind: "expression",
        params: { id },
      });
      return frozen.id;
    },

    commitSeparateWorksheets: (name) => {
      const s = get();
      const plan = s.separatePreview;
      if (!plan || plan.movingDatasetIds.length === 0) {
        s.setStatus("Separate unavailable: open a preview first");
        return null;
      }
      const live = new Set(s.datasets.map((d) => d.id));
      if (!plan.movingDatasetIds.every((id) => live.has(id))) {
        s.setStatus("Separate unavailable: the previewed worksheet changed — re-open Separate to refresh the plan");
        return null;
      }

      const trimmedName = (name ?? "").trim() || plan.suggestedName || "New Workbook";
      const movingSet = new Set(plan.movingDatasetIds);
      // P3 slice-2 fix: the REAL session-unique id is minted HERE, exactly
      // once, at commit — never during preview (see
      // PENDING_SEPARATE_WORKBOOK_ID's doc above). `plan.newWorkbookId`
      // (the shared placeholder) is deliberately never used past this point.
      const newWorkbookId = nextWorkbookId();

      get().recordHistory("separate worksheet");
      const newFolderId = plan.newWorkbookFolderId;
      const workbook: WorkbookNode = { id: newWorkbookId, name: trimmedName, folderId: newFolderId };
      set((st) => ({
        workbooks: [...st.workbooks, workbook],
        datasets: st.datasets.map((d) =>
          movingSet.has(d.id) ? { ...d, workbookId: newWorkbookId, folderId: newFolderId } : d,
        ),
        separatePreview: null,
      }));

      toast(`separated into "${trimmedName}"`, "ok");
      get().setStatus(`separated into "${trimmedName}"`);
      return newWorkbookId;
    },

    combineWorkbooks: (selection, name) => {
      const s = get();
      const targetIds = resolveCombineTargets(selection, s.datasets);
      if (targetIds.length === 0) {
        s.setStatus("Combine unavailable: nothing selected");
        return null;
      }
      const trimmedName = name.trim();
      if (!trimmedName) {
        s.setStatus("Combine unavailable: a workbook name is required");
        return null;
      }

      const newId = nextWorkbookId();
      const targetSet = new Set(targetIds);
      const orderedNames = targetIds.map((id) => s.datasets.find((d) => d.id === id)!.name);
      const dedupedNames = dedupeWorksheetNames(orderedNames);
      const nameById = new Map(targetIds.map((id, i) => [id, dedupedNames[i]]));

      get().recordHistory("combine workbooks");
      // New workbook lands at the Library root — combine never suggests a
      // folder (see this file's header P1 note) — so every moved worksheet's
      // folderId follows it there too, unconditionally, exactly like
      // moveWorkbookToFolder does for an ordinary workbook move.
      const workbook: WorkbookNode = { id: newId, name: trimmedName };
      set((st) => ({
        workbooks: [...st.workbooks, workbook],
        datasets: st.datasets.map((d) =>
          targetSet.has(d.id)
            ? { ...d, workbookId: newId, folderId: undefined, name: nameById.get(d.id)! }
            : d,
        ),
      }));

      const count = targetIds.length;
      toast(`combined ${count} worksheet${count === 1 ? "" : "s"} into "${trimmedName}"`, "ok");
      get().setStatus(`combined ${count} worksheet${count === 1 ? "" : "s"} into "${trimmedName}"`);
      return newId;
    },

    // Item 9's figure-doc half: a live doc only (a frozen doc's snapshot isn't
    // a live `Dataset` a window can bind to — that gap is Tier 3 item 11's
    // "snapshot-as-window"). Creates + focuses a new window bound to the doc's
    // dataset, then applies the config's channel/scale/label fields — NOT its
    // `seriesStyles` (a `FigureConfig` carries the EXPORT style shape,
    // `ExportSeriesStyle[]`, which has no inverse back to the live
    // `Record<number,SeriesStyle>`; the window opens with default series styling.
    openFigureDocInWindow: (id) => {
      const doc = get().figureDocs.find((f) => f.id === id);
      if (!doc || !doc.live || !doc.datasetId) return;
      const s = get();
      if (!s.datasets.some((dataset) => dataset.id === doc.datasetId)) return;
      const title = dedupeWindowTitle(
        doc.name,
        s.plotWindows.map((w) => displayedWindowTitle(w, s.datasets)),
      );
      const winId = s.createWindow(doc.datasetId, undefined, title);
      s.focusWindow(winId);
      const c = doc.config;
      const targetDs = s.datasets.find((d) => d.id === doc.datasetId);
      set((current) => ({
        // Plot-intent (item 1): "open in new window" always means look at the
        // plot, so surface it regardless of which tab was showing.
        ...(targetDs ? { stageTab: plotIntentStageTab(targetDs) } : {}),
        xKey: c.xKey,
        yKeys: c.yKeys,
        // P1.5: a legacy FigureDoc's own grouping (Graph Builder's
        // plotSpecToFigureDoc is the only producer) now carries over into the
        // opened window's live groupKey too, same as xKey/yKeys just above --
        // previously this whole binding was silently dropped on "open in window".
        groupKey: c.groupCol ?? null,
        xScale: c.xScale,
        yScale: c.yScale,
        plotTitle: c.title,
        xAxisLabel: c.xLabel,
        yAxisLabel: c.yLabel,
        // Item 3: the doc's own error bindings, if any (else createWindow's dataset-seeded errorRoles stand).
        ...(c.errors ? withWindowDocumentErrors(current.plotWindows, winId, c.errors) : {}),
      }));
      get().recordMacro(`Open figure "${doc.name}" in new window`, `qz.openFigureDocInWindow(${lit(id)})`);
    },

    saveQuickPlotTemplate: (datasetId, mapping, style, name, scope, look) => {
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
        look,
        labels: captureQuickPlotTemplateLabels(dataset, mapping),
      };
      set((s) => ({ quickPlotTemplates: [...s.quickPlotTemplates, entry] }));
      return id;
    },

    duplicateQuickPlotTemplate: (id) => {
      const state = get();
      const src = state.quickPlotTemplates.find((t) => t.id === id);
      if (!src) return null;
      get().recordHistory("Duplicate Quick Plot Template");
      const dedupedName = dedupeWindowTitle(`${src.name} copy`, state.quickPlotTemplates.map((t) => t.name));
      const now = new Date().toISOString();
      const copy: QuickPlotTemplate = { ...structuredClone(src), id: nextTemplateId(), name: dedupedName, createdAt: now, modifiedAt: now };
      set((s) => ({ quickPlotTemplates: [...s.quickPlotTemplates, copy] }));
      return copy.id;
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
      const created = get().createQuickFigureFromMapping(dataset.id, resolution.mapping, template.style, template.look);
      // P3.5 "recently used": only a figure that actually got created counts.
      // Every refusal above returns before this, and the create path can still
      // decline on its own (a gate this function does not re-check), so the
      // result is what decides -- not merely having reached this line.
      if (created) {
        recordRecipeUse({ kind: "quickPlot", scope: "project", id: template.id });
      }
      return created;
    },
  };
}
