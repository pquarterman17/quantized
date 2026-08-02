// Canonical FigureDocument bridge for MDI plot windows. Kept out of the
// pinned windows/useApp slices so document migration does not regrow them.
import {
  createFigureDocument,
  figureDocumentToPlotView,
  updateFigureDocumentFromPlotView,
  type FigureDocument,
} from "../lib/figureDocument";
import type { PlotView, PlotWindow } from "../lib/plotview";
import type { Dataset } from "../lib/types";

const figureIdForWindow = (windowId: string): string => `figure-${windowId}`;

export function plotWindowView(window: PlotWindow): PlotView {
  return window.kind === "plot" && window.document
    ? figureDocumentToPlotView(window.document)
    : window.view;
}

export function plotWindowDatasetId(window: PlotWindow): string | null {
  return window.kind === "plot" && window.document
    ? window.document.bindings.datasetId
    : window.datasetId;
}

export interface CreatePlotWindowDocumentOptions {
  previous?: FigureDocument;
  /** Mint a window-derived id even when `previous` is given — the DUPLICATE
   *  path. Without it a duplicated window shares the source's document
   *  identity, so Save on the duplicate would overwrite the original saved
   *  figure and the open-figure lookup becomes ambiguous. */
  freshIdentity?: boolean;
  /** `undefined` inherits the previous document's bindings; `null` derives
   *  fresh bindings from the view's own errKeys instead — the reset path.
   *  Without the sentinel, a resetErrors sync with no explicit list would
   *  resurrect the previous document's bindings, whose channel indices are
   *  exactly what a reimport shape change just invalidated (the row/column
   *  index-staleness class of 2026-07-19/21). */
  errors?: readonly NonNullable<Dataset["errorRoles"]>[number][] | null;
}

export function createPlotWindowDocument(
  windowId: string,
  name: string,
  datasetId: string | null,
  view: PlotView,
  options: CreatePlotWindowDocumentOptions = {},
): FigureDocument {
  const previous = options.previous;
  return createFigureDocument({
    id: options.freshIdentity ? figureIdForWindow(windowId) : (previous?.id ?? figureIdForWindow(windowId)),
    name,
    datasetId,
    view,
    mark: previous?.plot.mark,
    groupKey: previous?.bindings.groupKey,
    facetKey: previous?.bindings.facetKey,
    errors: options.errors === null ? undefined : (options.errors ?? previous?.bindings.errors),
    data: previous?.data,
    axisBreaks: previous?.plot.axisBreaks,
    output: previous?.output,
    publication: previous?.publication,
  });
}

interface SyncPlotWindowOptions {
  title?: string;
  datasetId?: string | null;
  errors?: readonly NonNullable<Dataset["errorRoles"]>[number][];
  resetErrors?: boolean;
}

/** Keep compatibility projections aligned while the document is authoritative at rest. */
export function syncPlotWindow(
  window: PlotWindow,
  view: PlotView,
  options: SyncPlotWindowOptions = {},
): PlotWindow {
  if (window.kind !== "plot") return { ...window, view };
  const title = options.title ?? window.title;
  const datasetId = options.datasetId === undefined ? window.datasetId : options.datasetId;
  const document = window.document && !options.resetErrors && options.errors === undefined
    ? updateFigureDocumentFromPlotView(window.document, { view, name: title, datasetId })
    : createPlotWindowDocument(window.id, title, datasetId, view, {
        previous: window.document,
        errors: options.resetErrors ? (options.errors ?? null) : (options.errors ?? window.document?.bindings.errors),
      });
  return {
    ...window,
    title: document.name,
    datasetId: document.bindings.datasetId,
    view: figureDocumentToPlotView(document),
    document,
  };
}

/** Replace a plot window's canonical document and regenerate every legacy
 * projection from it. Figure lifecycle actions must use this rather than
 * assigning `window.document` beside a hand-maintained title/view/datasetId
 * triple; that was exactly the desynchronization class found in the F1 review.
 */
export function withPlotWindowDocument(window: PlotWindow, document: FigureDocument): PlotWindow {
  if (window.kind !== "plot") return window;
  const canonical = structuredClone(document);
  return {
    ...window,
    title: canonical.name,
    datasetId: canonical.bindings.datasetId,
    view: figureDocumentToPlotView(canonical),
    document: canonical,
  };
}

export function commitFocusedPlotWindow(
  windows: readonly PlotWindow[],
  focusedId: string | null,
  view: PlotView,
): PlotWindow[] {
  return windows.map((window) => window.id === focusedId ? syncPlotWindow(window, view) : window);
}

export function rebindFocusedPlotWindow(
  windows: readonly PlotWindow[],
  focusedId: string | null,
  view: PlotView,
  dataset: Dataset,
): PlotWindow[] {
  return windows.map((window) =>
    window.id === focusedId
      ? syncPlotWindow(window, view, {
          datasetId: dataset.id,
          errors: dataset.errorRoles,
          resetErrors: true,
        })
      : window,
  );
}

export function syncDatasetWindowDocuments(
  windows: readonly PlotWindow[],
  datasetId: string,
  errors?: readonly NonNullable<Dataset["errorRoles"]>[number][],
): PlotWindow[] {
  return windows.map((window) =>
    window.datasetId === datasetId
      ? syncPlotWindow(window, window.view, { errors, resetErrors: true })
      : window,
  );
}

/** Remove deleted dataset bindings from both projections of every live plot
 * window. This belongs with the document-write chokepoint, rather than in the
 * pure PlotWindow model, so a future binding change cannot update only one.
 */
export function pruneWindowDatasetRefs(
  windows: readonly PlotWindow[],
  removed: ReadonlySet<string>,
): PlotWindow[] {
  return windows.map((window) => {
    // A canonical document wins over a stale compatibility projection. Fold
    // the removal into it first, then regenerate title/dataset/view together.
    // This also repairs a transitional window whose two dataset ids disagree.
    if (window.kind === "plot" && window.document) {
      const documentDatasetRemoved =
        window.document.bindings.datasetId !== null && removed.has(window.document.bindings.datasetId);
      const facadeDatasetRemoved = window.datasetId !== null && removed.has(window.datasetId);
      if (!documentDatasetRemoved && !facadeDatasetRemoved) return window;
      const document = documentDatasetRemoved
        ? { ...window.document, bindings: { ...window.document.bindings, datasetId: null } }
        : window.document;
      return withPlotWindowDocument(window, document);
    }
    const datasetRemoved = window.datasetId !== null && removed.has(window.datasetId);
    const panelDatasetIds = window.panel?.datasetIds;
    const panelChanged = panelDatasetIds?.some((id) => removed.has(id)) ?? false;
    if (!datasetRemoved && !panelChanged) return window;

    const datasetId = datasetRemoved ? null : window.datasetId;
    const panel = panelChanged && window.panel
      ? { ...window.panel, datasetIds: window.panel.datasetIds.filter((id) => !removed.has(id)) }
      : window.panel;
    return { ...window, datasetId, ...(panel ? { panel } : {}) };
  });
}
