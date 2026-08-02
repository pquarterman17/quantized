// Workspace boundary for document-backed plot windows. Legacy PlotView-only
// windows are promoted here; callers never need to maintain two migration paths.
import {
  createFigureDocument,
  figureDocumentToPlotView,
  figureDocumentVersion,
  sanitizeFigureDocument,
  type FigureDocument,
} from "./figureDocument";
import { sanitizePlotWindows, type PlotWindow } from "./plotview";

function rawDocumentsByWindowId(value: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!Array.isArray(value)) return out;
  for (const candidate of value) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const raw = candidate as Record<string, unknown>;
    if (typeof raw.id === "string" && raw.document !== undefined) out.set(raw.id, raw.document);
  }
  return out;
}

function migrateLegacyWindow(window: PlotWindow): FigureDocument {
  return createFigureDocument({
    id: `figure-${window.id}`,
    name: window.title,
    datasetId: window.datasetId,
    view: window.view,
  });
}

/** Validate current documents and deterministically promote pre-F1 plot windows.
 * A newer document schema cannot be safely rewritten, so that ONE window falls
 * back to its already-sanitized legacy PlotView projection and records a
 * non-persisted migration warning; valid siblings keep loading normally. */
export function sanitizeDocumentBackedPlotWindows(
  value: unknown,
  datasetIds: ReadonlySet<string>,
  migrationWarnings: string[] = [],
): PlotWindow[] {
  const windows = sanitizePlotWindows(value, datasetIds);
  const rawDocuments = rawDocumentsByWindowId(value);
  const usedDocumentIds = new Set<string>();

  return windows.map((window) => {
    if (window.kind !== "plot") return window;
    const rawDocument = rawDocuments.get(window.id);
    const version = figureDocumentVersion(rawDocument);
    const futureVersion = version !== null && version !== 1;
    if (futureVersion) {
      migrationWarnings.push(
        `plot window "${window.id}" uses unsupported FigureDocument version ${version}; restored its legacy PlotView projection`,
      );
    }

    let document = futureVersion
      ? migrateLegacyWindow(window)
      : (sanitizeFigureDocument(rawDocument) ?? migrateLegacyWindow(window));
    if (document.bindings.datasetId && !datasetIds.has(document.bindings.datasetId)) {
      document = { ...document, bindings: { ...document.bindings, datasetId: null } };
    }
    if (usedDocumentIds.has(document.id)) {
      document = createFigureDocument({
        id: `figure-${window.id}`,
        name: document.name,
        datasetId: document.bindings.datasetId,
        view: figureDocumentToPlotView(document),
        mark: document.plot.mark,
        groupKey: document.bindings.groupKey,
        facetKey: document.bindings.facetKey,
        errors: document.bindings.errors,
        data: document.data,
        axisBreaks: document.plot.axisBreaks,
        output: document.output,
      });
    }
    usedDocumentIds.add(document.id);
    return {
      ...window,
      title: document.name,
      datasetId: document.bindings.datasetId,
      view: figureDocumentToPlotView(document),
      document,
    };
  });
}
