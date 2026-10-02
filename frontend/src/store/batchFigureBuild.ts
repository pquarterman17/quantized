// Planning and atomic commit helpers for Batch Figure Builder. Resolution is
// delegated to Plot Recipe's one canonical matcher: this feature orchestrates
// many ordinary recipe applications; it does not introduce a second mapping
// engine or guess at missing columns.
import { createFigureDocument, type FigureDocument } from "../lib/figureDocument";
import { createPageDocument } from "../lib/pageDocumentActions";
import type { PageDocument } from "../lib/pageDocument";
import type { PlotRecipe } from "../lib/plotRecipeSchema";
import {
  resolveRecipe,
  type ResolvedRecipeApplication,
  type ResolveRecipeOptions,
} from "../lib/plotRecipeMatch";
import { dedupeWindowTitle } from "../lib/plotview";
import type { Dataset, FolderNode } from "../lib/types";
import type { WorkbookNode } from "../lib/workbooks";
import { subtreeIds } from "../lib/foldertree";
import { resolvedRecipeView } from "../lib/plotRecipeView";
import { nextRefLineId } from "./plotViewSettings";
import { useApp } from "./useApp";

export type BatchCompatibility = "ready" | "partial" | "blocked";

export interface BatchFigureRow {
  datasetId: string;
  datasetName: string;
  status: BatchCompatibility;
  summary: string;
  unmatched: string[];
  warnings: string[];
  resolved: ResolvedRecipeApplication | null;
}

export interface BatchRecipeChoice {
  key: string;
  scope: "project" | "global" | "built-in";
  recipe: PlotRecipe;
}

/** Imperative snapshot for the lazy workshop's event handlers. Kept outside
 * components/ so the render tree never grows a direct getState read. */
export const batchFigureAppState = () => useApp.getState();

/** Resolve the current Library intent into initial checked datasets. The
 * dialog still lists every loaded dataset, so this seed never traps someone
 * inside the selection they happened to have before opening it. */
export function batchSeedDatasetIds(input: {
  datasets: readonly Dataset[];
  folders: readonly FolderNode[];
  workbooks: readonly WorkbookNode[];
  selectedIds: readonly string[];
  activeId: string | null;
  librarySelection: { kind: string; id: string } | null;
}): string[] {
  const live = new Set(input.datasets.map((dataset) => dataset.id));
  const selected = [...new Set(input.selectedIds)].filter((id) => live.has(id));
  if (selected.length > 0) return selected;

  if (input.librarySelection?.kind === "workbook") {
    const ids = input.datasets
      .filter((dataset) => dataset.workbookId === input.librarySelection!.id)
      .map((dataset) => dataset.id);
    if (ids.length > 0) return ids;
  }

  if (input.librarySelection?.kind === "folder") {
    const folderIds = subtreeIds([...input.folders], input.librarySelection.id);
    const workbookIds = new Set(
      input.workbooks.filter((workbook) => workbook.folderId && folderIds.has(workbook.folderId)).map((workbook) => workbook.id),
    );
    const ids = input.datasets
      .filter((dataset) =>
        (dataset.folderId !== undefined && folderIds.has(dataset.folderId)) ||
        (dataset.workbookId !== undefined && workbookIds.has(dataset.workbookId)),
      )
      .map((dataset) => dataset.id);
    if (ids.length > 0) return ids;
  }

  return input.activeId && live.has(input.activeId) ? [input.activeId] : [];
}

/** One honest compatibility row. Spatial, map and composite-window recipes
 * are explicitly blocked because their non-plot state is not carried by an
 * editable FigureDocument; pretending otherwise would create a plausible but
 * incomplete output. */
export function preflightBatchFigure(
  recipe: PlotRecipe,
  dataset: Dataset,
  options: ResolveRecipeOptions,
): BatchFigureRow {
  if (recipe.transform) {
    return {
      datasetId: dataset.id,
      datasetName: dataset.name,
      status: "blocked",
      summary: `This recipe first runs the saved transformation “${recipe.transform.name}”. Batch transformation replay is not supported here; transform the datasets first, then use a recipe saved from that result.`,
      unmatched: [],
      warnings: [],
      resolved: null,
    };
  }
  const result = resolveRecipe(recipe, dataset, options);
  if ("refused" in result) {
    return {
      datasetId: dataset.id,
      datasetName: dataset.name,
      status: "blocked",
      summary: result.refused,
      unmatched: [],
      warnings: [],
      resolved: null,
    };
  }
  if (result.resolved.panelWindow || result.resolved.panels || result.resolved.map) {
    return {
      datasetId: dataset.id,
      datasetName: dataset.name,
      status: "blocked",
      summary: "This recipe contains a map or multi-dataset layout that cannot be repeated as one figure per dataset.",
      unmatched: result.unmatched,
      warnings: result.warnings,
      resolved: null,
    };
  }
  if (result.resolved.mapping.yKeys.length + result.resolved.mapping.y2Keys.length === 0) {
    return {
      datasetId: dataset.id,
      datasetName: dataset.name,
      status: "blocked",
      summary: "No plottable Y series matched. Creating this figure would produce a blank plot.",
      unmatched: result.unmatched,
      warnings: result.warnings,
      resolved: null,
    };
  }
  const partial = result.unmatched.length > 0;
  return {
    datasetId: dataset.id,
    datasetName: dataset.name,
    status: partial ? "partial" : "ready",
    summary: partial
      ? `${result.unmatched.length} recipe field${result.unmatched.length === 1 ? "" : "s"} did not match.`
      : result.warnings.length > 0
        ? `Compatible with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}.`
        : "Compatible",
    unmatched: result.unmatched,
    warnings: result.warnings,
    resolved: result.resolved,
  };
}

function formatName(pattern: string, dataset: string, recipe: string): string {
  const value = pattern.replaceAll("{dataset}", dataset).replaceAll("{recipe}", recipe).trim();
  return value || `${dataset} — ${recipe}`;
}

export interface BuildBatchFigureArtifactsInput {
  recipe: PlotRecipe;
  rows: readonly BatchFigureRow[];
  includedDatasetIds: ReadonlySet<string>;
  existingFigureNames: readonly string[];
  existingPageNames: readonly string[];
  namePattern: string;
  createPage: boolean;
  pageName: string;
  columns: number | "auto";
  nextFigureId: () => string;
  nextPageId: () => string;
}

export interface BatchFigureArtifacts {
  figures: FigureDocument[];
  page: PageDocument | null;
}

export interface BatchFigureCommitResult {
  pageOpened: boolean;
}

/** Commit an already-constructed batch as one undo step. If another Figure
 * Page is being edited, save the new page to the Library without replacing
 * that live session. */
export function commitBatchFigureArtifacts(artifacts: BatchFigureArtifacts): BatchFigureCommitResult {
  if (artifacts.figures.length === 0) return { pageOpened: false };
  const state = useApp.getState();
  const pageOpened = artifacts.page !== null && !state.figurePageOpen;
  state.recordHistory(`build ${artifacts.figures.length} figure${artifacts.figures.length === 1 ? "" : "s"}`);
  useApp.setState((current) => ({
    editableFigures: [...current.editableFigures, ...artifacts.figures],
    ...(artifacts.page
      ? {
          pages: [...current.pages, artifacts.page],
          ...(pageOpened
            ? {
                pageDocSeed: structuredClone(artifacts.page),
                figurePageOpen: true,
                librarySelection: { kind: "page" as const, id: artifacts.page.id },
                selectedIds: [],
              }
            : {}),
        }
      : {}),
    status: `created ${artifacts.figures.length} editable figure${artifacts.figures.length === 1 ? "" : "s"}${artifacts.page ? ` and page "${artifacts.page.name}"` : ""}`,
  }));
  return { pageOpened };
}

/** Construct every artifact before the store commit. A cancellation or an
 * exception therefore leaves the project completely untouched. */
export function buildBatchFigureArtifacts(input: BuildBatchFigureArtifactsInput): BatchFigureArtifacts {
  const names = [...input.existingFigureNames];
  const figures: FigureDocument[] = [];
  for (const row of input.rows) {
    if (!input.includedDatasetIds.has(row.datasetId) || !row.resolved) continue;
    const name = dedupeWindowTitle(formatName(input.namePattern, row.datasetName, input.recipe.name), names);
    names.push(name);
    const { mapping, visual } = row.resolved;
    const view = resolvedRecipeView(mapping, visual, nextRefLineId);
    figures.push(createFigureDocument({
      id: input.nextFigureId(),
      name,
      datasetId: row.datasetId,
      view,
      mark: visual.mark,
      groupKey: mapping.groupKey,
      facetKey: mapping.facetKey,
      errors: mapping.errors,
      axisBreaks: visual.axisBreaks,
    }));
  }

  if (!input.createPage || figures.length === 0) return { figures, page: null };
  const cols = input.columns === "auto"
    ? Math.max(1, Math.ceil(Math.sqrt(figures.length)))
    : Math.max(1, Math.min(input.columns, figures.length));
  const rows = Math.max(1, Math.ceil(figures.length / cols));
  const requestedPageName = input.pageName.trim() || `${input.recipe.name} batch`;
  const name = dedupeWindowTitle(requestedPageName, input.existingPageNames);
  const page = createPageDocument({
    id: input.nextPageId(),
    name,
    rows,
    cols,
    panels: figures.map((figure) => ({ figureId: figure.id, label: null, title: null })),
  });
  return { figures, page };
}
