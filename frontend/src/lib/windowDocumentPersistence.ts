// Workspace boundary for document-backed plot windows. Legacy PlotView-only
// windows are promoted here; callers never need to maintain two migration paths.
import {
  FIGURE_DOCUMENT_VERSION,
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
    // P1.5: createFigureDocument's `groupKey` is bindings-owned and comes
    // from this EXPLICIT arg, never `view.groupKey` (see its own doc) --
    // without threading it here, a pre-F1/document-less window (or any
    // window promoted through this legacy bridge) silently lost a durable
    // group binding on the very next .dwk save/reload.
    groupKey: window.view.groupKey,
    // F6 (SILENT_STATE_CORRUPTION_PLAN): `facetKey` joined the same
    // bindings-owned class as `groupKey` in F4.4 -- the same gap applies:
    // without threading it here, a faceted grid silently collapses to one
    // panel on the very next .dwk save/reload through this legacy bridge.
    facetKey: window.view.facetKey,
  });
}

/** Validate current documents and deterministically promote pre-F1 plot windows.
 * A newer document schema cannot be safely rewritten, so that ONE window falls
 * back to its already-sanitized legacy PlotView projection and records a
 * non-persisted migration warning; valid siblings keep loading normally.
 * `viewport` (LIBRARY_WORKBOOK_UX_PLAN PR E2) threads straight through to
 * `sanitizePlotWindows` for its restore-position clamp — see that function's
 * doc; omitted, it falls back to the same real-browser-window default. */
export function sanitizeDocumentBackedPlotWindows(
  value: unknown,
  datasetIds: ReadonlySet<string>,
  migrationWarnings: string[] = [],
  viewport?: { width: number; height: number },
): PlotWindow[] {
  const windows = sanitizePlotWindows(value, datasetIds, viewport);
  const rawDocuments = rawDocumentsByWindowId(value);
  const usedDocumentIds = new Set<string>();

  return windows.map((window) => {
    if (window.kind !== "plot") return window;
    const rawDocument = rawDocuments.get(window.id);
    const version = figureDocumentVersion(rawDocument);
    const futureVersion = version !== null && version > FIGURE_DOCUMENT_VERSION;
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
      // Every field the sibling constructor (windowDocuments.ts's
      // createPlotWindowDocument) forwards from `previous` must be forwarded
      // here too -- this is the SAME "mint a fresh id, keep everything else"
      // repair, just triggered by a duplicate id found at load time instead
      // of at create/duplicate time. `publication` (export overrides + exact
      // per-channel seriesStyles) was the one field missing (item 2); every
      // other field it forwards (mark/groupKey/facetKey/errors/data/
      // axisBreaks/output) was already here.
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
        publication: document.publication,
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
