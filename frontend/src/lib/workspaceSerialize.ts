// The .dwk WRITE side: the on-disk document shape (`WorkspaceDoc`) and
// `serializeWorkspace`. Extracted verbatim from `./workspace.ts` for the same
// reason and in the same shape as `./workspaceMerge.ts` before it — that file
// is the READ side (`parseWorkspace` + the sanitizers it drives) and was at
// its size pin, so the recipe-source fidelity signal had to be funded by an
// extraction rather than a bigger number.
//
// `workspace.ts` re-exports this, so every existing importer of
// `serializeWorkspace` is untouched. `WorkspaceDoc` stays module-private: it
// had exactly one consumer, the serializer below, and keeping it here is what
// makes "a new persisted field means a WorkspaceState field + a WorkspaceDoc
// field + a serializer default + a parseWorkspace sanitize step" (see
// `store/recode.ts`'s note) a two-file change instead of a scattered one.

import type { FigureDoc } from "./figuredoc";
import type { FigureDocument } from "./figureDocument";
import type { PageDocument } from "./pageDocument";
import type { PipelineStep } from "./pipeline";
import type { SavedPlotSpec } from "./plotspec";
import type { PlotRecipe } from "./plotRecipe";
import type { QuickPlotTemplate } from "./quickPlotTemplates";
import type { PlotWindow } from "./plotview";
import type { RoiDef } from "./roi";
import type { LibrarySelection } from "../store/libraryPanel";
import { serializeRois } from "../store/rois";
import type { TechniqueViewMemoryMap } from "./techniqueViewMemory";
import type { RecalcMode } from "./recalc";
import type { ReportEntry } from "./report";
import type { SmartFolder } from "./smartfolders";
import type { Collection } from "./collections";
import type { LibraryDetailsColumnKey } from "./libraryDetailsColumns";
import type { ToolWindowLayout } from "./toolwindow";
import { serializeComputedColumnsExtras } from "./workspaceComputedColumns";
import type { WorkbookNode } from "./workbooks";
import type { OriginFidelityEntry } from "./originFidelity";
import type { OriginFigureEntry } from "./originFigures";
import type { Dataset, FolderNode } from "./types";
import { WORKSPACE_FORMAT, WORKSPACE_VERSION, type WorkspaceState } from "./workspace";

interface WorkspaceDoc {
  format: string;
  version: number;
  savedAt: string;
  datasets: Dataset[];
  folders: FolderNode[];
  workbooks: WorkbookNode[];
  activeId: string | null;
  selectedIds: string[];
  expandedFolders: string[];
  originFigures: OriginFigureEntry[];
  originFidelity: OriginFidelityEntry[];
  smartFolders: SmartFolder[];
  reports: ReportEntry[];
  pipeline: PipelineStep[];
  recalcMode: RecalcMode;
  figureDocs: FigureDoc[];
  editableFigures: FigureDocument[];
  pages: PageDocument[];
  plotWindows: PlotWindow[];
  focusedWindowId: string | null;
  toolWindowLayout: Record<string, ToolWindowLayout>;
  savedPlotSpecs: SavedPlotSpec[];
  techniqueViewMemory: TechniqueViewMemoryMap;
  savedRois: RoiDef[];
  quickPlotTemplates: QuickPlotTemplate[];
  librarySelection: LibrarySelection | null;
  workbookLastChild: Record<string, string>;
  expandedWorkbookIds: string[];
  collections: Collection[];
  visibleDetailsColumns: LibraryDetailsColumnKey[];
  plotRecipes: PlotRecipe[];
}

/** Serialize the library + folder tree to a pretty-printed .dwk JSON document. */
export function serializeWorkspace(ws: WorkspaceState): string {
  const doc: WorkspaceDoc = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    savedAt: new Date().toISOString(),
    folders: ws.folders ?? [],
    workbooks: ws.workbooks ?? [],
    activeId: ws.activeId ?? null,
    selectedIds: ws.selectedIds ?? [],
    expandedFolders: ws.expandedFolders ?? [],
    originFigures: ws.originFigures ?? [],
    originFidelity: ws.originFidelity ?? [],
    smartFolders: ws.smartFolders ?? [],
    reports: ws.reports ?? [],
    pipeline: ws.macroSteps ?? [],
    recalcMode: ws.recalcMode ?? "auto",
    figureDocs: ws.figureDocs ?? [],
    editableFigures: ws.editableFigures ?? [],
    pages: ws.pages ?? [],
    // MULTI_PLOT_PLAN item 7: passed through VERBATIM — the caller (the
    // store's `windowsForSave()`, per the interface doc above) is
    // responsible for the focused window's live-view snapshot; this module
    // stays a plain serializer, same as every other field here.
    plotWindows: ws.plotWindows ?? [],
    focusedWindowId: ws.focusedWindowId ?? null,
    toolWindowLayout: ws.toolWindowLayout ?? {},
    savedPlotSpecs: ws.savedPlotSpecs ?? [],
    quickPlotTemplates: ws.quickPlotTemplates ?? [], // PR H — verbatim, same convention as savedPlotSpecs
    // PLOT_WORKFLOW_PLAN item 5: passed through verbatim, same convention as
    // `plotWindows` above — the caller (windowsForSave()'s save-time-freshen
    // sibling, `captureTechniqueView` applied to the live view) owns the fold.
    techniqueViewMemory: ws.techniqueViewMemory ?? {},
    // RSM_CUTS_PLAN item 13: named ROIs only (see WorkspaceState's doc) — the
    // actual (de)serialize logic lives in store/rois.ts, this module just calls it.
    savedRois: serializeRois(ws.savedRois ?? []),
    // PR E2: passed through verbatim, same plain-serializer convention as
    // every other field here.
    librarySelection: ws.librarySelection ?? null,
    workbookLastChild: ws.workbookLastChild ?? {},
    expandedWorkbookIds: ws.expandedWorkbookIds ?? [],
    collections: ws.collections ?? [],
    visibleDetailsColumns: ws.visibleDetailsColumns ?? [], // PR L slice 2 — verbatim; sanitizeVisibleDetailsColumns defaults on PARSE
    plotRecipes: ws.plotRecipes ?? [], // P1.3 — verbatim, same convention as savedPlotSpecs/quickPlotTemplates
    datasets: ws.datasets.map((d) => ({
      id: d.id,
      name: d.name,
      data: d.data,
      ...(d.raw ? { raw: d.raw } : {}),
      ...(d.corrections ? { corrections: d.corrections } : {}),
      ...(d.bgRef ? { bgRef: d.bgRef } : {}),
      ...(d.notes ? { notes: d.notes } : {}),
      ...(d.tags?.length ? { tags: d.tags } : {}),
      ...(d.group?.trim() ? { group: d.group } : {}),
      ...(d.folderId ? { folderId: d.folderId } : {}),
      ...(d.workbookId ? { workbookId: d.workbookId } : {}),
      ...(d.order !== undefined ? { order: d.order } : {}),
      ...(d.formulas?.length ? { formulas: d.formulas } : {}),
      ...serializeComputedColumnsExtras(d),
      ...(d.errorRoles !== undefined ? { errorRoles: d.errorRoles } : {}), // O1 exception: `[]` is meaningful -- lib/originBookRoles.ts
      ...(d.importedAt ? { importedAt: d.importedAt } : {}),
      ...(d.channelRoles && Object.keys(d.channelRoles).length ? { channelRoles: d.channelRoles } : {}),
      ...(d.channelTypes && Object.keys(d.channelTypes).length ? { channelTypes: d.channelTypes } : {}),
      ...(d.excludedRows?.length ? { excludedRows: d.excludedRows } : {}),
      ...(d.filter?.length ? { filter: d.filter } : {}),
      ...(d.fitSpec ? { fitSpec: d.fitSpec } : {}),
      // ORIGIN_FILE_DECODE_PLAN #38: an explicit "Save workspace (.dwk)…"
      // resolves every pending dataset FIRST (App.tsx's save command calls
      // `resolvePendingDatasets` before this runs), so `d.pending` is never
      // set in a real exported .dwk — only autosave (lib/autosave.ts, which
      // reuses this same serializer for its localStorage snapshot) can
      // legitimately still have one, and it's fine for that round-trip to
      // carry it: the render-side ensureBookData hooks re-fetch it the next
      // time that dataset is shown after a reload.
      ...(d.pending ? { pending: d.pending } : {}),
      ...(d.source ? { source: d.source } : {}),
      // P1.7 box 5: the lineage breadcrumb for "Import as new version" —
      // dropped entirely before (not just narrowed like `source`), so a
      // saved-and-reopened new-version dataset lost its link to the
      // original outright.
      ...(d.versionOf ? { versionOf: d.versionOf } : {}),
    })),
  };
  return JSON.stringify(doc, null, 2);
}
